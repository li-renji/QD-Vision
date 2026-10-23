/**
 * 导出控制器 —— **音频接线**测试。
 *
 * ## 验证什么
 *
 * `webCodecsExporter.ts` 的 `RenderOptions.audioBuffer` 早就预留好了，但**从来没有生产方**，
 * 于是 `if (options.audioCodec && options.audioBuffer)` 永不执行 → 导出静音 MP4。
 *
 * 本文件验证「离线混音 → `audioBuffer` → 导出器」这条链路**真的接上了**，
 * 并且验证**降级路径不会静默**：
 *
 * 1. 混音成功 → 导出器收到 `audioBuffer` + 与容器匹配的 `audioCodec`；
 * 2. 工程有声音但混音失败 → `job.warnings` 里有明确说明（不是静默静音）；
 * 3. 工程本来就没有声音 → 不告警、`audioCodec` 为 null；
 * 4. 浏览器不支持 `AudioEncoder` → 告警 + `audioCodec` 置空（不留空音轨）。
 *
 * @module services/export/__tests__/exportController.audio.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDoc } from '@clipcut/shared-types';
import { createEmptyProject } from '../../../domain/project/factory.js';
import type { CodecMatrix } from '../capabilityProbe.js';
import type { WebCodecsExportOptions } from '../webCodecsExporter.js';

// ============ mock ============

/** 捕获到的 `exportWithWebCodecs` 入参。 */
const captured: WebCodecsExportOptions[] = [];

/** `renderOfflineMix` 的返回值（由用例设置）。 */
const mixResult = {
  buffer: null as AudioBuffer | null,
  warnings: [] as string[],
  hasAudibleClips: false,
  mixedClipCount: 0,
  silent: true,
  peak: 0,
};

vi.mock('../capabilityProbe.js', () => ({
  probeCodecMatrix: async (): Promise<CodecMatrix> => ({
    video: {
      h264: { supported: true, codec: 'avc1.640028' },
      hevc: { supported: false, codec: null },
      vp9: { supported: true, codec: 'vp09.00.10.08' },
      av1: { supported: false, codec: null },
    },
    audio: {
      aac: { supported: true, codec: 'mp4a.40.2' },
      opus: { supported: true, codec: 'opus' },
    },
    recorder: { webm: true, mimeType: 'video/webm' },
    preferredExport: {
      format: 'mp4',
      video: 'avc1.640028',
      audio: 'mp4a.40.2',
      reason: '测试',
    },
  }),
}));

vi.mock('../webCodecsExporter.js', () => ({
  exportWithWebCodecs: async (options: WebCodecsExportOptions): Promise<Blob> => {
    captured.push(options);
    return new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' });
  },
}));

vi.mock('../mediaRecorderExporter.js', () => ({
  exportWithMediaRecorder: async (): Promise<{ blob: Blob; mimeType: string }> => ({
    blob: new Blob([], { type: 'video/webm' }),
    mimeType: 'video/webm',
  }),
}));

vi.mock('../offlineAudioRenderer.js', () => ({
  renderOfflineMix: async (): Promise<typeof mixResult> => ({
    ...mixResult,
    warnings: [...mixResult.warnings],
  }),
}));

vi.mock('../download.js', () => ({
  downloadBlob: (): void => {
    /* no-op */
  },
  createDownloadUrl: (): string => '',
}));

vi.mock('../../storage/blobRepo.js', () => ({
  putBlob: async (): Promise<void> => {
    /* no-op */
  },
  getBlobByKey: async (): Promise<Blob | null> => null,
}));

vi.mock('../../storage/exportHistoryRepo.js', () => ({
  addExportRecord: async (): Promise<void> => {
    /* no-op */
  },
}));

// 真实模块（放在 mock 之后导入，保证 mock 已注册）
const { ExportController } = await import('../exportController.js');

// ============ 夹具 ============

/** 造一个含音频片段的工程。 */
function makeDoc(withAudio: boolean): ProjectDoc {
  const doc = createEmptyProject('导出接线测试');
  return {
    ...doc,
    meta: { ...doc.meta, durationMs: 2000 },
    tracks: [
      {
        id: 'track_a',
        type: 'audio',
        name: '音频轨 1',
        order: 0,
        muted: false,
        hidden: false,
        locked: false,
        height: 48,
        clips: withAudio
          ? [
              {
                id: 'clip_1',
                assetId: 'asset_1',
                startMs: 0,
                durationMs: 2000,
                inMs: 0,
                outMs: 2000,
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
              },
            ]
          : [],
      },
    ],
  };
}

/** 造一个假 AudioBuffer。 */
function makeBuffer(): AudioBuffer {
  return {
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: 96_000,
    duration: 2,
    getChannelData: (): Float32Array => new Float32Array(96_000),
  } as unknown as AudioBuffer;
}

/** 默认导出请求。 */
function makeRequest(withAudio: boolean, format: 'mp4' | 'webm' = 'mp4') {
  return {
    doc: makeDoc(withAudio),
    format,
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: 4_000_000,
    audioBitrate: 128_000,
    burnInSubtitle: false,
    getFrame: async () => null,
  };
}

// ============ 用例 ============

describe('services/export/exportController · 音频接线', () => {
  beforeEach(() => {
    captured.length = 0;
    mixResult.buffer = null;
    mixResult.warnings = [];
    mixResult.hasAudibleClips = false;
    mixResult.mixedClipCount = 0;
    mixResult.silent = true;
    mixResult.peak = 0;
    vi.stubGlobal('AudioEncoder', class {});
  });

  it('混音成功 → 导出器收到 audioBuffer', async () => {
    mixResult.buffer = makeBuffer();
    mixResult.hasAudibleClips = true;

    const controller = new ExportController();
    const job = await controller.start(makeRequest(true));

    expect(job.status).toBe('done');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.audioBuffer).not.toBeNull();
    expect(captured[0]?.audioBuffer?.sampleRate).toBe(48_000);
    expect(captured[0]?.audioBuffer?.numberOfChannels).toBe(2);
  });

  it('MP4 → audioCodec 为 mp4a（AAC）', async () => {
    mixResult.buffer = makeBuffer();
    mixResult.hasAudibleClips = true;

    const controller = new ExportController();
    await controller.start(makeRequest(true, 'mp4'));

    expect(captured[0]?.audioCodec).toBe('mp4a.40.2');
  });

  it('WebM → audioCodec 为 opus', async () => {
    mixResult.buffer = makeBuffer();
    mixResult.hasAudibleClips = true;

    const controller = new ExportController();
    await controller.start(makeRequest(true, 'webm'));

    expect(captured[0]?.audioCodec).toBe('opus');
  });

  it('工程本来就没有音频 → 不告警、audioCodec 为 null', async () => {
    mixResult.buffer = null;
    mixResult.hasAudibleClips = false;

    const controller = new ExportController();
    const job = await controller.start(makeRequest(false));

    expect(job.status).toBe('done');
    expect(captured[0]?.audioBuffer).toBeNull();
    expect(captured[0]?.audioCodec).toBeNull();
    expect(job.warnings.filter((warning) => warning.includes('音频'))).toEqual([]);
  });

  it('工程有声音但混音失败 → 明确告警（不静默静音）', async () => {
    mixResult.buffer = null;
    mixResult.hasAudibleClips = true;
    mixResult.warnings = ['当前浏览器不支持离线音频渲染（OfflineAudioContext），导出结果将不含音频。'];

    const controller = new ExportController();
    const job = await controller.start(makeRequest(true));

    expect(job.status).toBe('done');
    expect(captured[0]?.audioBuffer).toBeNull();
    expect(captured[0]?.audioCodec).toBeNull();
    // 混音层告警 + 控制器层的「有音频但没声音」告警
    expect(job.warnings.some((warning) => warning.includes('OfflineAudioContext'))).toBe(true);
    expect(job.warnings.some((warning) => warning.includes('本次导出文件没有声音'))).toBe(true);
  });

  it('没有 AudioEncoder → 告警且 audioCodec 置空（不留空音轨）', async () => {
    mixResult.buffer = makeBuffer();
    mixResult.hasAudibleClips = true;
    vi.stubGlobal('AudioEncoder', undefined);

    const controller = new ExportController();
    const job = await controller.start(makeRequest(true));

    expect(captured[0]?.audioCodec).toBeNull();
    expect(job.warnings.some((warning) => warning.includes('AudioEncoder'))).toBe(true);
  });

  it('调用方自带 audioBuffer 时不再二次渲染', async () => {
    mixResult.buffer = null;
    mixResult.hasAudibleClips = false;

    const controller = new ExportController();
    await controller.start({
      ...makeRequest(true),
      audioBuffer: makeBuffer(),
    });

    expect(captured[0]?.audioBuffer).not.toBeNull();
  });

  it('skipAudio = true → 显式跳过混音', async () => {
    mixResult.buffer = makeBuffer();
    mixResult.hasAudibleClips = true;

    const controller = new ExportController();
    await controller.start({
      ...makeRequest(true),
      skipAudio: true,
    });

    expect(captured[0]?.audioBuffer).toBeNull();
    expect(captured[0]?.audioCodec).toBeNull();
  });
});
