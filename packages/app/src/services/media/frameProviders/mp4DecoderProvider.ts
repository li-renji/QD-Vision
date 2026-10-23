/**
 * 主路径取帧：mp4box 解封装 + `VideoDecoder` 硬解 + GOP 帧缓存。
 *
 * 关键点：
 * 1. **零上传**：素材字节从 IndexedDB 读出（`Blob`），绝不使用 `fetch`。
 * 2. `VideoFrame.close()` 必须在**拷贝之后**调用，否则画面为空。
 * 3. GOP 帧缓存：向前解码并只保留最近 N 帧（N ≤ 32），防止内存爆；
 *    随机 seek 时若目标不在缓存，则从最近的关键帧重新开始解码。
 */

import type { Asset } from '@clipcut/shared-types';
import { getVideoDecoderCtor, type VideoDecoderLike } from '../../../types/webcodecs.js';
import type { FrameProvider } from './types.js';

/** GOP 缓存上限（帧）。 */
export const MAX_GOP_CACHE_FRAMES = 32;

/** mp4box sample 的归一化描述。 */
interface SampleInfo {
  /** 显示时间戳（微秒） */
  timestampUs: number;
  /** 帧时长（微秒） */
  durationUs: number;
  /** 是否关键帧 */
  isSync: boolean;
  /** 压缩数据 */
  data: Uint8Array;
}

/** 单个素材的解码上下文。 */
interface DecodeContext {
  decoder: VideoDecoderLike;
  /** codec 描述串 */
  codec: string;
  /** 全部 sample（按时间升序） */
  samples: SampleInfo[];
  /** 已解码帧缓存：时间戳（微秒） → ImageBitmap */
  frames: Map<number, ImageBitmap>;
  /** 已解码到的 sample 下标（含） */
  decodedUpTo: number;
  /** 等待中的请求 */
  pending: Map<number, { resolve: (bmp: ImageBitmap) => void; reject: (e: unknown) => void }>;
  /** 当前解码起始的 sync sample 下标 */
  decodeGopStart: number;
}

/** 素材 id → 解码上下文。 */
const contexts = new Map<string, DecodeContext>();

/** 素材 id → 素材 Blob。 */
const assetBlobs = new Map<string, Blob>();

/** `EncodedVideoChunk` 构造器（通过 globalThis 取，避免依赖 TS lib 版本）。 */
interface EncodedVideoChunkCtor {
  new (init: {
    type: 'key' | 'delta';
    timestamp: number;
    duration?: number;
    data: unknown;
  }): unknown;
}

function getEncodedVideoChunkCtor(): EncodedVideoChunkCtor | undefined {
  return (globalThis as unknown as { EncodedVideoChunk?: EncodedVideoChunkCtor }).EncodedVideoChunk;
}

/** 找到 ≤ 目标下标的最大 sync sample 下标。 */
function findSyncIndex(samples: SampleInfo[], targetIndex: number): number {
  for (let i = Math.min(targetIndex, samples.length - 1); i >= 0; i -= 1) {
    const sample = samples[i];
    if (sample?.isSync) return i;
  }
  return 0;
}

/** 二分查找：找到时间戳 ≤ targetUs 的最后一个 sample 下标。 */
function findSampleIndex(samples: SampleInfo[], targetUs: number): number {
  let low = 0;
  let high = samples.length - 1;
  let result = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const sample = samples[mid];
    if (!sample) break;
    if (sample.timestampUs <= targetUs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/** mp4box 解封装 provider。 */
export class Mp4DecoderFrameProvider implements FrameProvider {
  readonly kind = 'mp4-decoder' as const;

  /** 注册素材 Blob。 */
  register(assetId: string, blob: Blob): void {
    assetBlobs.set(assetId, blob);
  }

  supports(asset: Asset): boolean {
    if (asset.type !== 'video') return false;
    if (!asset.mimeType.includes('mp4')) return false;
    return getVideoDecoderCtor() !== undefined;
  }

  async getFrameAt(assetId: string, sourceMs: number): Promise<ImageBitmap> {
    const context = await this.ensureContext(assetId);
    const targetUs = Math.max(0, Math.round(sourceMs)) * 1000;

    const cached = this.findCachedFrame(context, targetUs);
    if (cached) return cached;

    const targetIndex = findSampleIndex(context.samples, targetUs);
    const sample = context.samples[targetIndex];
    if (!sample) {
      throw new Error(`素材 ${assetId} 中没有可解码的帧`);
    }

    const promise = new Promise<ImageBitmap>((resolve, reject) => {
      context.pending.set(sample.timestampUs, { resolve, reject });
    });

    if (targetIndex > context.decodedUpTo || context.decodedUpTo < 0) {
      // 向前解码：若已解码位置比目标还靠后（回退 seek），从关键帧重来
      if (targetIndex <= context.decodedUpTo) {
        this.resetDecoder(context);
        const gopStart = findSyncIndex(context.samples, targetIndex);
        context.decodeGopStart = gopStart;
        context.decodedUpTo = gopStart - 1;
      }
      this.decodeFrom(context, context.decodedUpTo + 1, targetIndex);
    }

    return promise;
  }

  /** 在缓存中找最接近目标时间的帧（容差半帧）。 */
  private findCachedFrame(context: DecodeContext, targetUs: number): ImageBitmap | undefined {
    const direct = context.frames.get(targetUs);
    if (direct) return direct;

    let best: { key: number; bitmap: ImageBitmap } | null = null;
    for (const [key, bitmap] of context.frames) {
      const delta = Math.abs(key - targetUs);
      if (delta > 20_000) continue; // 20ms 容差
      if (!best || delta < Math.abs(best.key - targetUs)) best = { key, bitmap };
    }
    return best?.bitmap;
  }

  /** 确保解码上下文存在。 */
  private async ensureContext(assetId: string): Promise<DecodeContext> {
    const existing = contexts.get(assetId);
    if (existing) return existing;

    const decoderCtor = getVideoDecoderCtor();
    if (!decoderCtor) {
      throw new Error('当前环境不支持 WebCodecs VideoDecoder');
    }
    const chunkCtor = getEncodedVideoChunkCtor();
    if (!chunkCtor) {
      throw new Error('当前环境不支持 EncodedVideoChunk');
    }

    const blob = assetBlobs.get(assetId);
    if (!blob) {
      throw new Error(`未注册的素材：${assetId}`);
    }

    const { codec, samples } = await this.parseMp4(blob);
    if (samples.length === 0) {
      throw new Error(`素材 ${assetId} 中没有可用的视频 sample`);
    }

    const frames = new Map<number, ImageBitmap>();
    const pending = new Map<
      number,
      { resolve: (bmp: ImageBitmap) => void; reject: (e: unknown) => void }
    >();

    const decoder = new decoderCtor({
      output: (frame: unknown) => {
        const videoFrame = frame as {
          timestamp: number;
          close?: () => void;
          codedWidth?: number;
          codedHeight?: number;
          displayWidth?: number;
          displayHeight?: number;
        };
        const timestamp = videoFrame.timestamp;

        void createImageBitmap(videoFrame as unknown as ImageBitmapSource)
          .then((bitmap) => {
            frames.set(timestamp, bitmap);
            this.evict(frames);
            const waiter = pending.get(timestamp);
            if (waiter) {
              waiter.resolve(bitmap);
              pending.delete(timestamp);
            }
          })
          .catch((error: unknown) => {
            const waiter = pending.get(timestamp);
            if (waiter) {
              waiter.reject(error);
              pending.delete(timestamp);
            }
          })
          .finally(() => {
            // 必须在拷贝之后关闭，否则画面为空。
            videoFrame.close?.();
          });
      },
      error: (error: unknown) => {
        for (const waiter of pending.values()) waiter.reject(error);
        pending.clear();
      },
    });

    const context: DecodeContext = {
      decoder,
      codec,
      samples,
      frames,
      pending,
      decodedUpTo: -1,
      decodeGopStart: 0,
    };
    contexts.set(assetId, context);

    decoder.configure({ codec, optimizeForLatency: true });
    return context;
  }

  /** 用 mp4box 解封装出 sample 表。 */
  private async parseMp4(blob: Blob): Promise<{ codec: string; samples: SampleInfo[] }> {
    const { createFile } = await import('mp4box');
    const file = createFile();
    const samples: SampleInfo[] = [];

    const ready = new Promise<string>((resolve, reject) => {
      file.onReady = (info) => {
        const track = info.videoTracks[0];
        if (!track) {
          reject(new Error('MP4 中没有视频轨'));
          return;
        }
        resolve(track.codec);
      };
      file.onError = (error) => reject(new Error(error));
      file.onSamples = (_trackId: number, _user: unknown, chunk: unknown[]) => {
        for (const raw of chunk) {
          const sample = raw as {
            cts: number;
            dts: number;
            duration: number;
            timescale: number;
            is_sync: boolean;
            data: ArrayBuffer | Uint8Array;
          };
          const data =
            sample.data instanceof Uint8Array ? sample.data : new Uint8Array(sample.data);
          samples.push({
            timestampUs: Math.round((sample.cts / sample.timescale) * 1_000_000),
            durationUs: Math.round((sample.duration / sample.timescale) * 1_000_000),
            isSync: Boolean(sample.is_sync),
            data,
          });
        }
      };
    });

    const buffer = await blob.arrayBuffer();
    const data = buffer as ArrayBuffer & { fileStart?: number };
    data.fileStart = 0;
    file.appendBuffer(data);
    file.flush();

    const codec = await ready;
    samples.sort((a, b) => a.timestampUs - b.timestampUs);
    return { codec, samples };
  }

  /** 从 `fromIndex` 解码到 `toIndex`（含）。 */
  private decodeFrom(context: DecodeContext, fromIndex: number, toIndex: number): void {
    const chunkCtor = getEncodedVideoChunkCtor();
    if (!chunkCtor) return;

    for (let i = Math.max(0, fromIndex); i <= toIndex; i += 1) {
      const sample = context.samples[i];
      if (!sample) break;
      try {
        const chunk = new chunkCtor({
          type: sample.isSync ? 'key' : 'delta',
          timestamp: sample.timestampUs,
          duration: sample.durationUs,
          data: sample.data,
        });
        context.decoder.decode(chunk);
      } catch (error) {
        for (const waiter of context.pending.values()) waiter.reject(error);
        context.pending.clear();
        return;
      }
      context.decodedUpTo = i;
    }
  }

  /** 重置解码器（回退 seek 时）。 */
  private resetDecoder(context: DecodeContext): void {
    try {
      context.decoder.close();
    } catch {
      // 已关闭
    }
    for (const bitmap of context.frames.values()) bitmap.close?.();
    context.frames.clear();
  }

  /** LRU 淘汰。 */
  private evict(frames: Map<number, ImageBitmap>): void {
    while (frames.size > MAX_GOP_CACHE_FRAMES) {
      const oldestKey = frames.keys().next().value as number | undefined;
      if (oldestKey === undefined) return;
      const bitmap = frames.get(oldestKey);
      bitmap?.close?.();
      frames.delete(oldestKey);
    }
  }

  dispose(): void {
    for (const context of contexts.values()) {
      try {
        context.decoder.close();
      } catch {
        // 已关闭
      }
      for (const bitmap of context.frames.values()) bitmap.close?.();
      context.frames.clear();
      context.pending.clear();
    }
    contexts.clear();
    assetBlobs.clear();
  }
}
