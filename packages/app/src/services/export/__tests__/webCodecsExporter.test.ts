/**
 * WebCodecs 主路径导出器测试（BUG-04）。
 *
 * ## 测试边界（重要）
 *
 * happy-dom / Node **没有真实的 WebCodecs 实现**，本文件因此**不尝试真正编码视频**：
 * - `VideoEncoder` / `VideoFrame` / `AudioEncoder` / `AudioData` 全部是 mock；
 * - `mp4-muxer` 也被 mock（真实封装需要合法的 `EncodedVideoChunk` 二进制）。
 *
 * 本文件验证的是**分支选择与参数传递**：
 * 1. 能力缺失 → 明确报错（而不是静默产出坏文件）；
 * 2. 容器 codec 映射（avc / hevc / av1 / vp9）与音频 codec 映射（aac / opus）；
 * 3. 编码器配置参数（分辨率 / 码率 / 帧率 / latencyMode）；
 * 4. 关键帧间隔、进度回调、取消信号、资源释放（`close()` / `finalize()`）。
 *
 * ⚠️ **真实编码路径（实际封装出的 MP4 是否可播放）必须浏览器真机验证**。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDoc } from '@clipcut/shared-types';
import { createEmptyProject } from '../../../domain/project/factory.js';
import type { ExportPlan } from '../../../domain/export/exportPlan.js';
import {
  AUDIO_CHUNK_SAMPLES,
  KEYFRAME_INTERVAL_MS,
  exportWithWebCodecs,
  type WebCodecsExportOptions,
} from '../webCodecsExporter.js';

// ============ mp4-muxer mock ============

/** 记录到的 Muxer 构造参数与调用。 */
interface MuxerRecord {
  options: Record<string, unknown>;
  videoChunks: Array<{ chunk: unknown; meta: unknown }>;
  audioChunks: Array<{ chunk: unknown; meta: unknown }>;
  finalized: boolean;
}

const { muxerRecords, muxerCtorCount } = vi.hoisted(() => ({
  muxerRecords: [] as unknown[],
  muxerCtorCount: { value: 0 },
}));

vi.mock('mp4-muxer', () => {
  class ArrayBufferTargetMock {
    buffer = new ArrayBuffer(16);
  }

  class MuxerMock {
    readonly target: { buffer: ArrayBuffer };

    readonly options: Record<string, unknown>;

    readonly videoChunks: Array<{ chunk: unknown; meta: unknown }> = [];

    readonly audioChunks: Array<{ chunk: unknown; meta: unknown }> = [];

    finalized = false;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.target = options['target'] as { buffer: ArrayBuffer };
      muxerCtorCount.value += 1;
      muxerRecords.push(this);
    }

    addVideoChunk(chunk: unknown, meta: unknown): void {
      this.videoChunks.push({ chunk, meta });
    }

    addAudioChunk(chunk: unknown, meta: unknown): void {
      this.audioChunks.push({ chunk, meta });
    }

    finalize(): void {
      this.finalized = true;
    }
  }

  return { Muxer: MuxerMock, ArrayBufferTarget: ArrayBufferTargetMock };
});

// ============ WebCodecs mock ============

/** 编码器调用记录。 */
interface EncoderRecord {
  config: Record<string, unknown> | null;
  encodes: Array<{ frame: unknown; options: unknown }>;
  flushed: number;
  closed: number;
}

/** 所有创建出来的编码器记录。 */
const encoderRecords: EncoderRecord[] = [];

/** 所有创建出来的 VideoFrame 记录。 */
const frameRecords: Array<{ timestamp: number; duration: number; closed: number }> = [];

/** 所有创建出来的 AudioData 记录。 */
const audioDataRecords: Array<{
  format: string;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  data: Float32Array;
  closed: number;
}> = [];

/** VideoEncoder mock。 */
class MockVideoEncoder {
  readonly record: EncoderRecord = { config: null, encodes: [], flushed: 0, closed: 0 };

  private readonly onOutput: (chunk: unknown, meta?: unknown) => void;

  constructor(init: { output: (chunk: unknown, meta?: unknown) => void }) {
    this.onOutput = init.output;
    encoderRecords.push(this.record);
  }

  configure(config: Record<string, unknown>): void {
    this.record.config = config;
  }

  encode(frame: unknown, options?: unknown): void {
    this.record.encodes.push({ frame, options });
    // 真实编码器会异步回调 output；这里同步回调以驱动 muxer 逻辑。
    this.onOutput(
      { type: 'key', timestamp: 0, duration: 1, byteLength: 4 },
      { decoderConfig: { codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080 } },
    );
  }

  async flush(): Promise<void> {
    this.record.flushed += 1;
  }

  close(): void {
    this.record.closed += 1;
  }
}

/** VideoFrame mock。 */
class MockVideoFrame {
  readonly closed = 0;

  constructor(
    readonly source: unknown,
    init: { timestamp: number; duration: number },
  ) {
    frameRecords.push({ ...init, closed: 0 });
  }

  close(): void {
    const last = frameRecords[frameRecords.length - 1];
    if (last) last.closed += 1;
  }
}

/** AudioEncoder mock。 */
class MockAudioEncoder {
  readonly record: EncoderRecord = { config: null, encodes: [], flushed: 0, closed: 0 };

  private readonly onOutput: (chunk: unknown, meta?: unknown) => void;

  constructor(init: { output: (chunk: unknown, meta?: unknown) => void }) {
    this.onOutput = init.output;
    encoderRecords.push(this.record);
  }

  configure(config: Record<string, unknown>): void {
    this.record.config = config;
  }

  encode(data: unknown): void {
    this.record.encodes.push({ frame: data, options: undefined });
    this.onOutput({ type: 'key', timestamp: 0, duration: 1, byteLength: 4 });
  }

  async flush(): Promise<void> {
    this.record.flushed += 1;
  }

  close(): void {
    this.record.closed += 1;
  }
}

/** AudioData mock。 */
class MockAudioData {
  readonly closed = 0;

  constructor(init: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: Float32Array;
  }) {
    audioDataRecords.push({ ...init, closed: 0 });
  }

  close(): void {
    const last = audioDataRecords[audioDataRecords.length - 1];
    if (last) last.closed += 1;
  }
}

// ============ 2D 画布 mock ============

/** 可记录调用的假 2D 上下文。 */
function createMockContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    miterLimit: 10,
    letterSpacing: '0px',
    save() {
      /* no-op */
    },
    restore() {
      /* no-op */
    },
    translate() {
      /* no-op */
    },
    rotate() {
      /* no-op */
    },
    scale() {
      /* no-op */
    },
    beginPath() {
      /* no-op */
    },
    closePath() {
      /* no-op */
    },
    clip() {
      /* no-op */
    },
    moveTo() {
      /* no-op */
    },
    lineTo() {
      /* no-op */
    },
    quadraticCurveTo() {
      /* no-op */
    },
    fillRect() {
      /* no-op */
    },
    drawImage() {
      /* no-op */
    },
    fillText() {
      /* no-op */
    },
    strokeText() {
      /* no-op */
    },
    measureText(text: string) {
      return { width: text.length * 10 };
    },
  } as unknown as CanvasRenderingContext2D;
}

// ============ 夹具构造 ============

/** 造一个只有视频轨的工程（避免触发文字绘制分支）。 */
function makeDoc(clips: Array<Record<string, unknown>> = []): ProjectDoc {
  const doc = createEmptyProject('导出测试');
  return {
    ...doc,
    meta: { ...doc.meta, durationMs: 1000 },
    tracks: [
      {
        id: 'track_v1',
        type: 'video',
        name: '视频轨 1',
        order: 0,
        muted: false,
        hidden: false,
        locked: false,
        height: 64,
        clips: clips as never,
      },
    ],
  };
}

/** 造一个 clip。 */
function makeClip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    startMs: 0,
    durationMs: 1000,
    inMs: 100,
    outMs: 1100,
    speed: 1,
    isOverlay: false,
    zIndex: 0,
    transform: {
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      opacity: 1,
      fit: 'contain',
      cornerRadius: 0,
    },
    audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
    label: null,
    ...overrides,
  };
}

/** 造一个导出计划。 */
function makePlan(overrides: Partial<ExportPlan> = {}): ExportPlan {
  return {
    totalFrames: 12,
    frameDurationMs: 1000 / 30,
    durationMs: 1000,
    video: { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
    audio: { bitrate: 192_000, sampleRate: 48_000, channels: 2 },
    estimatedSizeBytes: 1024,
    errors: [],
    suggestions: [],
    ...overrides,
  };
}

/** 造一个假 AudioBuffer。 */
function makeAudioBuffer(length: number, channels = 2, sampleRate = 48_000): AudioBuffer {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) {
    const arr = new Float32Array(length);
    for (let i = 0; i < length; i += 1) arr[i] = (i + c) / 1000;
    data.push(arr);
  }
  return {
    numberOfChannels: channels,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: (c: number) => data[c] ?? new Float32Array(length),
  } as unknown as AudioBuffer;
}

/** 造一个假 ImageBitmap。 */
function makeBitmap(): ImageBitmap {
  return { width: 1920, height: 1080, close: () => undefined } as unknown as ImageBitmap;
}

/** 默认导出参数。 */
function makeOptions(overrides: Partial<WebCodecsExportOptions> = {}): WebCodecsExportOptions {
  return {
    doc: makeDoc([makeClip()]),
    plan: makePlan(),
    getFrame: async () => makeBitmap(),
    audioBuffer: null,
    videoCodec: 'avc1.640028',
    audioCodec: null,
    ...overrides,
  };
}

describe('services/export/webCodecsExporter', () => {
  beforeEach(() => {
    encoderRecords.length = 0;
    frameRecords.length = 0;
    audioDataRecords.length = 0;
    muxerRecords.length = 0;
    muxerCtorCount.value = 0;

    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal('VideoFrame', MockVideoFrame);
    vi.stubGlobal('AudioEncoder', MockAudioEncoder);
    vi.stubGlobal('AudioData', MockAudioData);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createMockContext());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('能力探测与降级', () => {
    it('没有 VideoEncoder 时明确报错（不产出坏文件）', async () => {
      vi.stubGlobal('VideoEncoder', undefined);

      await expect(exportWithWebCodecs(makeOptions())).rejects.toThrowError(
        '当前浏览器不支持 WebCodecs VideoEncoder',
      );
      expect(muxerCtorCount.value).toBe(0);
    });

    it('画布拿不到 2D 上下文时明确报错', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      await expect(exportWithWebCodecs(makeOptions())).rejects.toThrowError(
        '无法创建 2D 画布上下文',
      );
      expect(muxerCtorCount.value).toBe(1);
    });
  });

  describe('容器 codec 映射', () => {
    it('avc 开头 → avc', async () => {
      await exportWithWebCodecs(makeOptions({ videoCodec: 'avc1.640028' }));

      const record = muxerRecords[0] as MuxerRecord;
      expect((record.options['video'] as Record<string, unknown>)['codec']).toBe('avc');
    });

    it('hvc 开头 → hevc', async () => {
      await exportWithWebCodecs(makeOptions({ videoCodec: 'hvc1.1.6.L93.B0' }));

      const record = muxerRecords[0] as MuxerRecord;
      expect((record.options['video'] as Record<string, unknown>)['codec']).toBe('hevc');
    });

    it('av01 开头 → av1', async () => {
      await exportWithWebCodecs(makeOptions({ videoCodec: 'av01.0.04M.08' }));

      const record = muxerRecords[0] as MuxerRecord;
      expect((record.options['video'] as Record<string, unknown>)['codec']).toBe('av1');
    });

    it('其它（vp09 等）→ vp9 兜底', async () => {
      await exportWithWebCodecs(makeOptions({ videoCodec: 'vp09.00.10.08' }));

      const record = muxerRecords[0] as MuxerRecord;
      expect((record.options['video'] as Record<string, unknown>)['codec']).toBe('vp9');
    });

    it('视频轨参数透传给 muxer（分辨率 / 帧率 / fastStart）', async () => {
      await exportWithWebCodecs(makeOptions({ plan: makePlan() }));

      const record = muxerRecords[0] as MuxerRecord;
      expect(record.options['video']).toEqual({
        codec: 'avc',
        width: 1920,
        height: 1080,
        frameRate: 30,
      });
      expect(record.options['fastStart']).toBe('in-memory');
      expect(record.options['firstTimestampBehavior']).toBe('offset');
    });
  });

  describe('音频轨配置', () => {
    it('audioCodec 为 null 时不配置音频轨', async () => {
      await exportWithWebCodecs(makeOptions({ audioCodec: null, audioBuffer: makeAudioBuffer(100) }));

      const record = muxerRecords[0] as MuxerRecord;
      expect(record.options['audio']).toBeUndefined();
    });

    it('mp4a 开头 → aac，并带采样率与声道数', async () => {
      await exportWithWebCodecs(
        makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: makeAudioBuffer(100, 2, 44_100) }),
      );

      const record = muxerRecords[0] as MuxerRecord;
      expect(record.options['audio']).toEqual({
        codec: 'aac',
        sampleRate: 44_100,
        numberOfChannels: 2,
      });
    });

    it('非 mp4a → opus', async () => {
      await exportWithWebCodecs(
        makeOptions({ audioCodec: 'opus', audioBuffer: makeAudioBuffer(100, 1, 48_000) }),
      );

      const record = muxerRecords[0] as MuxerRecord;
      expect((record.options['audio'] as Record<string, unknown>)['codec']).toBe('opus');
    });

    it('没有 AudioBuffer 时用默认采样率 48k / 立体声', async () => {
      await exportWithWebCodecs(makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: null }));

      const record = muxerRecords[0] as MuxerRecord;
      expect(record.options['audio']).toEqual({
        codec: 'aac',
        sampleRate: 48_000,
        numberOfChannels: 2,
      });
    });

    it('没有 AudioEncoder 时跳过音频编码（视频仍正常导出）', async () => {
      vi.stubGlobal('AudioEncoder', undefined);

      const blob = await exportWithWebCodecs(
        makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: makeAudioBuffer(100) }),
      );

      expect(blob.type).toBe('video/mp4');
      expect(audioDataRecords.length).toBe(0);
    });
  });

  describe('视频轨编码', () => {
    it('编码器配置带上分辨率 / 码率 / 帧率 / latencyMode', async () => {
      await exportWithWebCodecs(makeOptions({ videoCodec: 'avc1.640028' }));

      const record = encoderRecords[0];
      expect(record?.config).toEqual({
        codec: 'avc1.640028',
        width: 1920,
        height: 1080,
        bitrate: 8_000_000,
        framerate: 30,
        latencyMode: 'quality',
      });
    });

    it('逐帧编码，帧数等于 totalFrames', async () => {
      await exportWithWebCodecs(makeOptions({ plan: makePlan({ totalFrames: 7 }) }));

      expect(encoderRecords[0]?.encodes.length).toBe(7);
    });

    it('关键帧间隔 = KEYFRAME_INTERVAL_MS / fps', async () => {
      await exportWithWebCodecs(makeOptions({ plan: makePlan({ totalFrames: 10 }) }));

      const encodes = encoderRecords[0]?.encodes ?? [];
      const expectedInterval = Math.round((KEYFRAME_INTERVAL_MS / 1000) * 30);
      expect(expectedInterval).toBe(60);
      // 前 10 帧里只有第 0 帧是关键帧
      expect((encodes[0]?.options as { keyFrame: boolean }).keyFrame).toBe(true);
      expect((encodes[1]?.options as { keyFrame: boolean }).keyFrame).toBe(false);
    });

    it('VideoFrame 的时间戳按帧序号递增', async () => {
      await exportWithWebCodecs(makeOptions({ plan: makePlan({ totalFrames: 3 }) }));

      expect(frameRecords.map((frame) => frame.timestamp)).toEqual([0, 33333, 66667]);
      expect(frameRecords[0]?.duration).toBe(33333);
    });

    it('每个 VideoFrame 编码后立即 close（无泄漏）', async () => {
      await exportWithWebCodecs(makeOptions({ plan: makePlan({ totalFrames: 5 }) }));

      expect(frameRecords.length).toBe(5);
      expect(frameRecords.every((frame) => frame.closed === 1)).toBe(true);
    });

    it('编码结束后 flush 并 close 编码器', async () => {
      await exportWithWebCodecs(makeOptions());

      expect(encoderRecords[0]?.flushed).toBe(1);
      expect(encoderRecords[0]?.closed).toBe(1);
    });

    it('muxer 收到所有视频分片并 finalize', async () => {
      await exportWithWebCodecs(makeOptions({ plan: makePlan({ totalFrames: 4 }) }));

      const record = muxerRecords[0] as MuxerRecord;
      expect(record.videoChunks.length).toBe(4);
      expect(record.finalized).toBe(true);
    });

    it('产物是 video/mp4 的 Blob', async () => {
      const blob = await exportWithWebCodecs(makeOptions());

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('video/mp4');
      expect(blob.size).toBeGreaterThan(0);
    });
  });

  describe('取帧请求', () => {
    it('只对时间范围内的可见片段取帧，且源时间按变速换算', async () => {
      const calls: Array<{ assetId: string; sourceMs: number }> = [];
      const doc = makeDoc([
        makeClip({ id: 'clip_a', assetId: 'asset_a', startMs: 0, durationMs: 1000, inMs: 100, speed: 2 }),
        makeClip({ id: 'clip_b', assetId: 'asset_b', startMs: 5000, durationMs: 1000, inMs: 0, speed: 1 }),
        makeClip({ id: 'clip_c', assetId: null, startMs: 0, durationMs: 1000, inMs: 0, speed: 1 }),
      ]);

      await exportWithWebCodecs(
        makeOptions({
          doc,
          plan: makePlan({ totalFrames: 1 }),
          getFrame: async (assetId: string, sourceMs: number) => {
            calls.push({ assetId, sourceMs });
            return makeBitmap();
          },
        }),
      );

      // 只有 clip_a 在 t=0 命中（clip_b 尚未开始，clip_c 无素材）
      expect(calls).toHaveLength(1);
      expect(calls[0]?.assetId).toBe('asset_a');
      // sourceMs = inMs + (timeMs - startMs) * speed = 100 + 0 * 2
      expect(calls[0]?.sourceMs).toBe(100);
    });
  });

  describe('音频轨编码', () => {
    it('按 AUDIO_CHUNK_SAMPLES 分块交错编码', async () => {
      const length = AUDIO_CHUNK_SAMPLES + 476;

      await exportWithWebCodecs(
        makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: makeAudioBuffer(length, 2) }),
      );

      expect(audioDataRecords.length).toBe(2);
      expect(audioDataRecords[0]?.numberOfFrames).toBe(AUDIO_CHUNK_SAMPLES);
      expect(audioDataRecords[1]?.numberOfFrames).toBe(476);
      expect(audioDataRecords[0]?.format).toBe('f32');
      expect(audioDataRecords[0]?.numberOfChannels).toBe(2);
    });

    it('交错顺序为「逐帧 L R」', async () => {
      await exportWithWebCodecs(
        makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: makeAudioBuffer(4, 2) }),
      );

      const data = audioDataRecords[0]?.data ?? new Float32Array(0);
      // 源数据：ch0[i] = i/1000，ch1[i] = (i+1)/1000
      expect(data[0]).toBeCloseTo(0, 6);
      expect(data[1]).toBeCloseTo(0.001, 6);
      expect(data[2]).toBeCloseTo(0.001, 6);
      expect(data[3]).toBeCloseTo(0.002, 6);
    });

    it('音频分片时间戳按采样率换算', async () => {
      await exportWithWebCodecs(
        makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: makeAudioBuffer(2048, 1, 48_000) }),
      );

      expect(audioDataRecords[0]?.timestamp).toBe(0);
      expect(audioDataRecords[1]?.timestamp).toBe(Math.round((1024 / 48_000) * 1_000_000));
    });

    it('音频编码器配置带上采样率 / 声道 / 码率', async () => {
      await exportWithWebCodecs(
        makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: makeAudioBuffer(100, 2, 44_100) }),
      );

      const audioEncoder = encoderRecords[1];
      expect(audioEncoder?.config).toEqual({
        codec: 'mp4a.40.2',
        sampleRate: 44_100,
        numberOfChannels: 2,
        bitrate: 192_000,
      });
    });

    it('每个 AudioData 编码后立即 close', async () => {
      await exportWithWebCodecs(
        makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: makeAudioBuffer(1500, 1) }),
      );

      expect(audioDataRecords.length).toBe(2);
      expect(audioDataRecords.every((data) => data.closed === 1)).toBe(true);
    });

    it('muxer 收到音频分片', async () => {
      await exportWithWebCodecs(
        makeOptions({ audioCodec: 'mp4a.40.2', audioBuffer: makeAudioBuffer(100, 1) }),
      );

      const record = muxerRecords[0] as MuxerRecord;
      expect(record.audioChunks.length).toBeGreaterThan(0);
    });
  });

  describe('进度回调', () => {
    it('每 5 帧与最后一帧上报进度', async () => {
      const ratios: number[] = [];

      await exportWithWebCodecs(
        makeOptions({
          plan: makePlan({ totalFrames: 12 }),
          onProgress: (progress) => ratios.push(progress.ratio),
        }),
      );

      expect(ratios).toEqual([1 / 12, 6 / 12, 11 / 12, 1]);
    });

    it('进度携带当前时间与总时长', async () => {
      const seen: Array<{ currentTimeMs: number; totalTimeMs: number }> = [];

      await exportWithWebCodecs(
        makeOptions({
          plan: makePlan({ totalFrames: 6 }),
          onProgress: (progress) =>
            seen.push({ currentTimeMs: progress.currentTimeMs, totalTimeMs: progress.totalTimeMs }),
        }),
      );

      expect(seen[0]?.currentTimeMs).toBe(0);
      expect(seen[0]?.totalTimeMs).toBe(1000);
      expect(seen[seen.length - 1]?.currentTimeMs).toBe((5 * 1000) / 30);
    });
  });

  describe('取消与资源释放', () => {
    it('已取消的 signal 触发 AbortError', async () => {
      const controller = new AbortController();
      controller.abort();

      let caught: unknown = null;
      try {
        await exportWithWebCodecs(makeOptions({ signal: controller.signal }));
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(DOMException);
      expect((caught as DOMException).name).toBe('AbortError');
      expect((caught as DOMException).message).toBe('导出已取消');
    });

    it('取消时编码器仍被 close（不泄漏）', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(exportWithWebCodecs(makeOptions({ signal: controller.signal }))).rejects.toThrow();

      expect(encoderRecords[0]?.closed).toBe(1);
    });

    it('取消时不 finalize（产物不完整，直接丢弃）', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(exportWithWebCodecs(makeOptions({ signal: controller.signal }))).rejects.toThrow();

      const record = muxerRecords[0] as MuxerRecord;
      expect(record.finalized).toBe(false);
    });
  });
});
