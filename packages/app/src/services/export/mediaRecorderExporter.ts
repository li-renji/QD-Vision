/**
 * 兜底导出器：`canvas.captureStream()` + `MediaRecorder`（仅 WebM）。
 *
 * 特点：
 * - **实时录制**：需提示「请勿切走标签页」。
 * - WebCodecs 不可用时**自动切换**并提示「性能较低导出模式」，不报错不阻断。
 */

import type { ProjectDoc } from '@clipcut/shared-types';
import type { ExportPlan } from '../../domain/export/exportPlan.js';
import { renderFrame } from '../../render/compositor.js';

/** 兜底导出参数。 */
export interface MediaRecorderExportOptions {
  doc: ProjectDoc;
  plan: ExportPlan;
  /** 取帧函数（同步） */
  getFrame: (assetId: string, sourceMs: number) => ImageBitmap | null;
  /** 混音流（可选） */
  audioStream: MediaStream | null;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 进度回调 */
  onProgress?: (progress: {
    currentTimeMs: number;
    totalTimeMs: number;
    elapsedMs: number;
    estimatedRemainingMs: number;
    ratio: number;
  }) => void;
}

/** 兜底导出器返回结果。 */
export interface MediaRecorderExportResult {
  blob: Blob;
  mimeType: string;
}

/**
 * 使用 MediaRecorder 导出 WebM。
 */
export async function exportWithMediaRecorder(
  options: MediaRecorderExportOptions,
): Promise<MediaRecorderExportResult> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('当前浏览器不支持 MediaRecorder，无法使用兜底导出模式。');
  }

  const { doc, plan, signal } = options;
  const { width, height, fps } = plan.video;

  const mimeType =
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((candidate) => {
      try {
        return MediaRecorder.isTypeSupported(candidate);
      } catch {
        return false;
      }
    }) ?? 'video/webm';

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布上下文');

  const canvasStream = canvas.captureStream(fps);
  const tracks = [...canvasStream.getVideoTracks()];
  if (options.audioStream) {
    for (const track of options.audioStream.getAudioTracks()) {
      tracks.push(track);
    }
  }
  const stream = new MediaStream(tracks);

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: plan.video.bitrate,
    audioBitsPerSecond: plan.audio.bitrate,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event: Event) => reject(new Error(`MediaRecorder 错误：${String(event)}`));
  });

  recorder.start(1000);
  const startedAt = performance.now();
  const frameDurationMs = 1000 / fps;

  try {
    for (let index = 0; index < plan.totalFrames; index += 1) {
      if (signal?.aborted) {
        throw new DOMException('导出已取消', 'AbortError');
      }

      const timeMs = index * frameDurationMs;
      renderFrame(ctx, doc, timeMs, { getFrame: options.getFrame });

      if (index % 5 === 0 || index === plan.totalFrames - 1) {
        const elapsed = performance.now() - startedAt;
        const ratio = (index + 1) / plan.totalFrames;
        options.onProgress?.({
          currentTimeMs: timeMs,
          totalTimeMs: plan.durationMs,
          elapsedMs: elapsed,
          estimatedRemainingMs: ratio > 0 ? elapsed / ratio - elapsed : 0,
          ratio,
        });
      }

      // 实时录制：等待真实时间流逝
      await new Promise<void>((resolve) => {
        setTimeout(resolve, frameDurationMs);
      });
    }
  } finally {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  await finished;

  return {
    blob: new Blob(chunks, { type: mimeType }),
    mimeType,
  };
}
