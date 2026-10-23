/**
 * 主路径导出器：逐帧离线渲染 → `VideoEncoder` + `AudioEncoder` → `mp4-muxer` → Blob。
 *
 * 特点：
 * - **离线逐帧**（无实时约束），1080p30 一分钟素材可远快于实时。
 * - 关键帧间隔 2s。
 * - 音频来自 `OfflineAudioContext` 渲染的混音总线（与预览同拓扑）。
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { ProjectDoc } from '@clipcut/shared-types';
import type { ExportPlan } from '../../domain/export/exportPlan.js';
import { renderFrame, sourceTimeMs } from '../../render/compositor.js';
import { getAudioEncoderCtor, getVideoEncoderCtor } from '../../types/webcodecs.js';

/** mp4-muxer 的 chunk 类型（避免直接引用 WebCodecs 全局类型名）。 */
type MuxerVideoChunk = Parameters<Muxer<ArrayBufferTarget>['addVideoChunk']>[0];
type MuxerVideoMeta = Parameters<Muxer<ArrayBufferTarget>['addVideoChunk']>[1];
type MuxerAudioChunk = Parameters<Muxer<ArrayBufferTarget>['addAudioChunk']>[0];
type MuxerAudioMeta = Parameters<Muxer<ArrayBufferTarget>['addAudioChunk']>[1];

/** 导出参数。 */
export interface WebCodecsExportOptions {
  /** 工程 */
  doc: ProjectDoc;
  /** 导出计划 */
  plan: ExportPlan;
  /** 取帧函数（异步） */
  getFrame: (assetId: string, sourceMs: number) => Promise<ImageBitmap | null>;
  /** 混音结果（可选） */
  audioBuffer: AudioBuffer | null;
  /** 视频 codec 串（如 `avc1.640028`） */
  videoCodec: string;
  /** 音频 codec 串（如 `mp4a.40.2`）；null 表示不含音频 */
  audioCodec: string | null;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 进度回调 */
  onProgress?: (progress: ExportProgress) => void;
}

/** 导出进度。 */
export interface ExportProgress {
  currentTimeMs: number;
  totalTimeMs: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  /** 0~1 */
  ratio: number;
}

/** 关键帧间隔（毫秒）。 */
export const KEYFRAME_INTERVAL_MS = 2000;

/** 每次送入编码器的音频样本数。 */
export const AUDIO_CHUNK_SAMPLES = 1024;

/** 把 WebCodecs codec 串映射到 mp4-muxer 的容器 codec。 */
function muxerVideoCodec(codec: string): 'avc' | 'hevc' | 'vp9' | 'av1' {
  if (codec.startsWith('avc')) return 'avc';
  if (codec.startsWith('hvc')) return 'hevc';
  if (codec.startsWith('av01')) return 'av1';
  return 'vp9';
}

/** 取帧请求。 */
interface FrameRequest {
  assetId: string;
  sourceMs: number;
}

/**
 * 收集当前时间所有活跃视频 clip 的取帧请求。
 */
function collectFrameRequests(doc: ProjectDoc, timeMs: number): FrameRequest[] {
  const requests: FrameRequest[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.assetId === null) continue;
      if (timeMs < clip.startMs || timeMs >= clip.startMs + clip.durationMs) continue;
      requests.push({ assetId: clip.assetId, sourceMs: sourceTimeMs(clip, timeMs) });
    }
  }
  return requests;
}

/**
 * 异步渲染一帧：先并发取帧，再交给同步的合成器绘制。
 */
async function renderFrameAsync(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDoc,
  timeMs: number,
  getFrame: (assetId: string, sourceMs: number) => Promise<ImageBitmap | null>,
): Promise<void> {
  const requests = collectFrameRequests(doc, timeMs);
  const bitmaps = await Promise.all(
    requests.map((request) => getFrame(request.assetId, request.sourceMs)),
  );

  // 建立 assetId → (sourceMs → bitmap) 的同步查表
  const table = new Map<string, Map<number, ImageBitmap | null>>();
  requests.forEach((request, index) => {
    let inner = table.get(request.assetId);
    if (!inner) {
      inner = new Map<number, ImageBitmap | null>();
      table.set(request.assetId, inner);
    }
    inner.set(request.sourceMs, bitmaps[index] ?? null);
  });

  renderFrame(ctx, doc, timeMs, {
    getFrame: (assetId, sourceMs) => {
      const inner = table.get(assetId);
      if (!inner) return null;
      const exact = inner.get(sourceMs);
      if (exact !== undefined) return exact;
      // 容差匹配（浮点误差兜底）
      for (const [key, bitmap] of inner) {
        if (Math.abs(key - sourceMs) < 0.5) return bitmap;
      }
      return null;
    },
  });
}

/**
 * 使用 WebCodecs 导出。
 */
export async function exportWithWebCodecs(options: WebCodecsExportOptions): Promise<Blob> {
  const { doc, plan, signal } = options;

  const videoCtor = getVideoEncoderCtor();
  if (!videoCtor) {
    throw new Error('当前浏览器不支持 WebCodecs VideoEncoder');
  }

  const { width, height, fps, bitrate } = plan.video;
  const totalFrames = plan.totalFrames;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: muxerVideoCodec(options.videoCodec),
      width,
      height,
      frameRate: fps,
    },
    ...(options.audioCodec
      ? {
          audio: {
            codec: options.audioCodec.startsWith('mp4a') ? ('aac' as const) : ('opus' as const),
            sampleRate: options.audioBuffer?.sampleRate ?? 48_000,
            numberOfChannels: options.audioBuffer?.numberOfChannels ?? 2,
          },
        }
      : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布上下文');

  const startedAt = performance.now();
  const keyframeIntervalFrames = Math.max(1, Math.round((KEYFRAME_INTERVAL_MS / 1000) * fps));

  // ---- 视频轨 ----
  const videoChunks: MuxerVideoChunk[] = [];
  const videoMetas: MuxerVideoMeta[] = [];

  const encoder = new videoCtor({
    output: (chunk: unknown, metadata?: unknown) => {
      videoChunks.push(chunk as MuxerVideoChunk);
      videoMetas.push(metadata as MuxerVideoMeta);
    },
    error: (error: unknown) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
  });

  encoder.configure({
    codec: options.videoCodec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
  });

  try {
    for (let index = 0; index < totalFrames; index += 1) {
      if (signal?.aborted) {
        throw new DOMException('导出已取消', 'AbortError');
      }

      const timeMs = (index * 1000) / fps;
      await renderFrameAsync(ctx, doc, timeMs, options.getFrame);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((index * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });

      encoder.encode(frame, { keyFrame: index % keyframeIntervalFrames === 0 });
      frame.close();

      if (index % 5 === 0 || index === totalFrames - 1) {
        const elapsed = performance.now() - startedAt;
        const ratio = (index + 1) / totalFrames;
        options.onProgress?.({
          currentTimeMs: timeMs,
          totalTimeMs: plan.durationMs,
          elapsedMs: elapsed,
          estimatedRemainingMs: ratio > 0 ? elapsed / ratio - elapsed : 0,
          ratio,
        });
        // 让出主线程，保持 UI 响应
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    }

    await encoder.flush();
  } finally {
    encoder.close();
  }

  for (let i = 0; i < videoChunks.length; i += 1) {
    const chunk = videoChunks[i];
    if (!chunk) continue;
    muxer.addVideoChunk(chunk, videoMetas[i]);
  }

  // ---- 音频轨 ----
  if (options.audioCodec && options.audioBuffer) {
    const audioCtor = getAudioEncoderCtor();
    if (audioCtor) {
      const audioChunks: MuxerAudioChunk[] = [];
      const audioMetas: MuxerAudioMeta[] = [];

      const audioEncoder = new audioCtor({
        output: (chunk: unknown, metadata?: unknown) => {
          audioChunks.push(chunk as MuxerAudioChunk);
          audioMetas.push(metadata as MuxerAudioMeta);
        },
      });

      audioEncoder.configure({
        codec: options.audioCodec,
        sampleRate: options.audioBuffer.sampleRate,
        numberOfChannels: options.audioBuffer.numberOfChannels,
        bitrate: plan.audio.bitrate,
      });

      try {
        const channelData: Float32Array[] = [];
        for (let c = 0; c < options.audioBuffer.numberOfChannels; c += 1) {
          channelData.push(options.audioBuffer.getChannelData(c));
        }

        const totalSamples = options.audioBuffer.length;
        const channelCount = options.audioBuffer.numberOfChannels;
        for (let offset = 0; offset < totalSamples; offset += AUDIO_CHUNK_SAMPLES) {
          if (signal?.aborted) {
            throw new DOMException('导出已取消', 'AbortError');
          }
          const count = Math.min(AUDIO_CHUNK_SAMPLES, totalSamples - offset);
          const interleaved = new Float32Array(count * channelCount);
          for (let i = 0; i < count; i += 1) {
            for (let c = 0; c < channelData.length; c += 1) {
              interleaved[i * channelCount + c] = channelData[c]?.[offset + i] ?? 0;
            }
          }

          const audioData = new AudioData({
            format: 'f32',
            sampleRate: options.audioBuffer.sampleRate,
            numberOfFrames: count,
            numberOfChannels: channelCount,
            timestamp: Math.round((offset / options.audioBuffer.sampleRate) * 1_000_000),
            data: interleaved,
          });
          audioEncoder.encode(audioData);
          audioData.close();
        }

        await audioEncoder.flush();
      } finally {
        audioEncoder.close();
      }

      for (let i = 0; i < audioChunks.length; i += 1) {
        const chunk = audioChunks[i];
        if (!chunk) continue;
        muxer.addAudioChunk(chunk, audioMetas[i]);
      }
    }
  }

  muxer.finalize();
  const buffer = muxer.target.buffer;
  return new Blob([buffer], { type: 'video/mp4' });
}
