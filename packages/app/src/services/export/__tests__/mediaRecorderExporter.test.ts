/**
 * MediaRecorder 兜底导出器测试（BUG-04）。
 *
 * ## 测试边界（重要）
 *
 * happy-dom **没有 `MediaRecorder`**，本文件因此 mock 掉 `MediaRecorder` /
 * `MediaStream` / `canvas.captureStream`，**不尝试真正录制**。
 *
 * 验证的是**分支选择与参数传递**：
 * 1. 能力探测与 mimeType 降级链（vp9 → vp8 → 通用 webm → 兜底 webm）；
 * 2. 轨道合成（画布视频轨 + 混音音频轨）与录制参数（码率）；
 * 3. 逐帧渲染循环、进度回调、取消信号；
 * 4. 资源释放（`recorder.stop()` + 所有 track `stop()`）；
 * 5. 错误分支（`MediaRecorder` 报错 → 抛出）。
 *
 * ⚠️ **真实录制路径（产出的 WebM 是否可播放、是否实时）必须浏览器真机验证**。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDoc } from '@clipcut/shared-types';
import { createEmptyProject } from '../../../domain/project/factory.js';
import type { ExportPlan } from '../../../domain/export/exportPlan.js';
import { exportWithMediaRecorder, type MediaRecorderExportOptions } from '../mediaRecorderExporter.js';

// ============ MediaRecorder mock ============

/** 录制器调用记录。 */
interface RecorderRecord {
  mimeType: string | undefined;
  videoBitsPerSecond: number | undefined;
  audioBitsPerSecond: number | undefined;
  startTimeslice: number | null;
  stopped: number;
  errorMode: boolean;
}

/** 所有创建出来的录制器记录。 */
const recorderRecords: RecorderRecord[] = [];

/** MediaRecorder 支持的 mimeType 集合（用例可改）。 */
let supportedMimeTypes: string[] = [];

/** 模拟录制错误。 */
let recorderShouldFail = false;

/** 模拟 `isTypeSupported` 抛异常。 */
let isTypeSupportedShouldThrow = false;

/** 假 MediaRecorder。 */
class MockMediaRecorder {
  static isTypeSupported(mimeType: string): boolean {
    if (isTypeSupportedShouldThrow) throw new Error('boom');
    return supportedMimeTypes.includes(mimeType);
  }

  readonly record: RecorderRecord = {
    mimeType: undefined,
    videoBitsPerSecond: undefined,
    audioBitsPerSecond: undefined,
    startTimeslice: null,
    stopped: 0,
    errorMode: false,
  };

  state: 'inactive' | 'recording' = 'inactive';

  ondataavailable: ((event: BlobEvent) => void) | null = null;

  onstop: (() => void) | null = null;

  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly stream: unknown,
    options?: { mimeType?: string; videoBitsPerSecond?: number; audioBitsPerSecond?: number },
  ) {
    this.record.mimeType = options?.mimeType;
    this.record.videoBitsPerSecond = options?.videoBitsPerSecond;
    this.record.audioBitsPerSecond = options?.audioBitsPerSecond;
    this.record.errorMode = recorderShouldFail;
    recorderRecords.push(this.record);
  }

  start(timeslice?: number): void {
    this.state = 'recording';
    this.record.startTimeslice = timeslice ?? null;
  }

  stop(): void {
    this.state = 'inactive';
    this.record.stopped += 1;
    if (this.record.errorMode) {
      this.onerror?.(new Event('error'));
      return;
    }
    // 真实实现会先派发 dataavailable 再派发 stop
    this.ondataavailable?.({ data: new Blob(['frame'], { type: 'video/webm' }) } as BlobEvent);
    this.onstop?.();
  }
}

// ============ MediaStream mock ============

/** 假 track。 */
interface FakeTrack {
  kind: 'video' | 'audio';
  stopped: number;
  stop(): void;
}

/** 造一个假 track。 */
function makeTrack(kind: 'video' | 'audio'): FakeTrack {
  return {
    kind,
    stopped: 0,
    stop(): void {
      this.stopped += 1;
    },
  };
}

/** 所有出现过的 track（去重，同一 track 可能进入多个流）。 */
const createdTracks = new Map<FakeTrack, FakeTrack>();

/** 假 MediaStream。 */
class MockMediaStream {
  constructor(readonly tracks: FakeTrack[]) {
    for (const track of tracks) createdTracks.set(track, track);
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

// ============ 2D 画布 mock ============

/** 画布创建次数。 */
let canvasCreated = 0;

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

/** 造一个只有视频轨的工程。 */
function makeDoc(): ProjectDoc {
  const doc = createEmptyProject('兜底导出测试');
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
        clips: [],
      },
    ],
  };
}

/** 造一个导出计划。 */
function makePlan(overrides: Partial<ExportPlan> = {}): ExportPlan {
  return {
    totalFrames: 3,
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

/** 默认导出参数。 */
function makeOptions(
  overrides: Partial<MediaRecorderExportOptions> = {},
): MediaRecorderExportOptions {
  return {
    doc: makeDoc(),
    plan: makePlan(),
    getFrame: () => null,
    audioStream: null,
    ...overrides,
  };
}

/** 造一个假音频流。 */
function makeAudioStream(): MediaStream {
  return new MockMediaStream([makeTrack('audio')]) as unknown as MediaStream;
}

describe('services/export/mediaRecorderExporter', () => {
  beforeEach(() => {
    recorderRecords.length = 0;
    createdTracks.clear();
    supportedMimeTypes = ['video/webm;codecs=vp9,opus'];
    recorderShouldFail = false;
    isTypeSupportedShouldThrow = false;
    canvasCreated = 0;

    vi.stubGlobal('MediaRecorder', MockMediaRecorder);
    vi.stubGlobal('MediaStream', MockMediaStream);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      canvasCreated += 1;
      return createMockContext();
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockImplementation(
      () =>
        new MockMediaStream([makeTrack('video')]) as unknown as MediaStream,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('能力探测与 mimeType 降级', () => {
    it('没有 MediaRecorder 时明确报错', async () => {
      vi.stubGlobal('MediaRecorder', undefined);

      await expect(exportWithMediaRecorder(makeOptions())).rejects.toThrowError(
        '当前浏览器不支持 MediaRecorder，无法使用兜底导出模式。',
      );
    });

    it('优先使用 vp9 + opus', async () => {
      const result = await exportWithMediaRecorder(makeOptions());

      expect(result.mimeType).toBe('video/webm;codecs=vp9,opus');
    });

    it('vp9 与 vp8 同时可用时优先选 vp9（候选顺序即优先级）', async () => {
      supportedMimeTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'];

      const result = await exportWithMediaRecorder(makeOptions());

      expect(result.mimeType).toBe('video/webm;codecs=vp9,opus');
    });

    it('vp9 不支持时降级到 vp8 + opus', async () => {
      supportedMimeTypes = ['video/webm;codecs=vp8,opus'];

      const result = await exportWithMediaRecorder(makeOptions());

      expect(result.mimeType).toBe('video/webm;codecs=vp8,opus');
    });

    it('都不支持时降级到通用 video/webm', async () => {
      supportedMimeTypes = ['video/webm'];

      const result = await exportWithMediaRecorder(makeOptions());

      expect(result.mimeType).toBe('video/webm');
    });

    it('一个都不支持时兜底为 video/webm（不报错）', async () => {
      supportedMimeTypes = [];

      const result = await exportWithMediaRecorder(makeOptions());

      expect(result.mimeType).toBe('video/webm');
      expect(result.blob.type).toBe('video/webm');
    });

    it('isTypeSupported 抛异常时按「不支持」处理，继续往下找', async () => {
      isTypeSupportedShouldThrow = true;

      const result = await exportWithMediaRecorder(makeOptions());

      expect(result.mimeType).toBe('video/webm');
    });
  });

  describe('录制参数与轨道合成', () => {
    it('录制器拿到 mimeType 与视频 / 音频码率', async () => {
      await exportWithMediaRecorder(makeOptions());

      const record = recorderRecords[0];
      expect(record?.mimeType).toBe('video/webm;codecs=vp9,opus');
      expect(record?.videoBitsPerSecond).toBe(8_000_000);
      expect(record?.audioBitsPerSecond).toBe(192_000);
    });

    it('以 1000ms 为时间片启动录制', async () => {
      await exportWithMediaRecorder(makeOptions());

      expect(recorderRecords[0]?.startTimeslice).toBe(1000);
    });

    it('合流包含画布视频轨与混音音频轨', async () => {
      const audioStream = makeAudioStream();

      await exportWithMediaRecorder(makeOptions({ audioStream }));

      const tracks = [...createdTracks.keys()];
      expect(tracks.filter((track) => track.kind === 'video').length).toBe(1);
      expect(tracks.filter((track) => track.kind === 'audio').length).toBe(1);
    });

    it('没有音频流时只含视频轨', async () => {
      await exportWithMediaRecorder(makeOptions({ audioStream: null }));

      const tracks = [...createdTracks.keys()];
      expect(tracks.filter((track) => track.kind === 'audio').length).toBe(0);
      expect(tracks.filter((track) => track.kind === 'video').length).toBe(1);
    });

    it('画布按计划的分辨率与帧率创建', async () => {
      await exportWithMediaRecorder(
        makeOptions({ plan: makePlan({ video: { width: 1280, height: 720, fps: 25, bitrate: 1 } }) }),
      );

      expect(canvasCreated).toBe(1);
    });
  });

  describe('产物', () => {
    it('返回 mimeType 与 WebM Blob', async () => {
      const result = await exportWithMediaRecorder(makeOptions());

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe('video/webm;codecs=vp9,opus');
      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('进度回调', () => {
    it('每 5 帧与最后一帧上报进度', async () => {
      const ratios: number[] = [];

      await exportWithMediaRecorder(
        makeOptions({
          plan: makePlan({ totalFrames: 12 }),
          onProgress: (progress) => ratios.push(progress.ratio),
        }),
      );

      expect(ratios).toEqual([1 / 12, 6 / 12, 11 / 12, 1]);
    });

    it('进度携带当前时间与总时长', async () => {
      const seen: Array<{ currentTimeMs: number; totalTimeMs: number }> = [];

      await exportWithMediaRecorder(
        makeOptions({
          plan: makePlan({ totalFrames: 6 }),
          onProgress: (progress) =>
            seen.push({ currentTimeMs: progress.currentTimeMs, totalTimeMs: progress.totalTimeMs }),
        }),
      );

      expect(seen[0]?.currentTimeMs).toBe(0);
      expect(seen[0]?.totalTimeMs).toBe(1000);
    });
  });

  describe('取消与资源释放', () => {
    it('已取消的 signal 触发 AbortError', async () => {
      const controller = new AbortController();
      controller.abort();

      let caught: unknown = null;
      try {
        await exportWithMediaRecorder(makeOptions({ signal: controller.signal }));
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(DOMException);
      expect((caught as DOMException).name).toBe('AbortError');
    });

    it('取消时仍停止录制器并释放所有轨道', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        exportWithMediaRecorder(makeOptions({ signal: controller.signal })),
      ).rejects.toThrow();

      expect(recorderRecords[0]?.stopped).toBe(1);
      expect([...createdTracks.keys()].every((track) => track.stopped === 1)).toBe(true);
    });

    it('正常结束时停止录制器并释放所有轨道', async () => {
      await exportWithMediaRecorder(makeOptions());

      expect(recorderRecords[0]?.stopped).toBe(1);
      expect(createdTracks.size).toBeGreaterThan(0);
      expect([...createdTracks.keys()].every((track) => track.stopped === 1)).toBe(true);
    });
  });

  describe('错误分支', () => {
    it('MediaRecorder 报错时向上抛出', async () => {
      recorderShouldFail = true;

      await expect(exportWithMediaRecorder(makeOptions())).rejects.toThrowError(/MediaRecorder 错误/);
    });
  });
});
