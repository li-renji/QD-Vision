/**
 * 离线混音渲染测试（导出音频链路）。
 *
 * ## 测试分层
 *
 * 1. **纯函数层**（时间映射）：`resolveClipScheduling` —— 这是最容易出错的部分，
 *    单独抽出来直接测数值，不依赖任何 WebAudio 对象。
 * 2. **编排层**（建图 / 排程 / 告警）：用**假 OfflineAudioContext** 驱动
 *    `renderOfflineMix`，断言 source 的 `start/stop/playbackRate` 调用、
 *    包络事件、告警文案与降级行为。
 *
 * happy-dom / Node **没有真实的 `OfflineAudioContext` 与 `decodeAudioData`**，
 * 因此第 2 层靠注入实现（`createOfflineContext` / `readAssetBytes`），
 * 而不是靠 mock 全局。
 *
 * ⚠️ **变异自查**：把 `resolveClipScheduling` 里的 `durationSec` 与 `timelineDurationSec`
 * 对调、把 `stopSec` 去掉、或把 `playbackRate` 写成 1，本文件必须变红。
 */

import { describe, expect, it } from 'vitest';
import type { Clip, ProjectDoc } from '@clipcut/shared-types';
import { createEmptyProject } from '../../../domain/project/factory.js';
import {
  collectMixableAssetIds,
  hasAudibleAudio,
  peakAmplitude,
  renderOfflineMix,
  resolveClipScheduling,
  resolveExportMasterGain,
  type OfflineRenderContext,
} from '../offlineAudioRenderer.js';

// ============ 夹具 ============

/** 造一个 clip。 */
function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    startMs: 0,
    durationMs: 1000,
    inMs: 0,
    outMs: 1000,
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

/** 造一个只含一条轨道的工程。 */
function makeDoc(clips: Clip[], trackOverrides: Record<string, unknown> = {}): ProjectDoc {
  const doc = createEmptyProject('离线混音测试');
  return {
    ...doc,
    meta: { ...doc.meta, durationMs: 10_000 },
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
        clips,
        ...trackOverrides,
      },
    ],
  };
}

/** 造一个假 AudioBuffer。 */
function makeAudioBuffer(
  channels: number,
  length: number,
  sampleRate: number,
  peak = 0.5,
): AudioBuffer {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) {
    const arr = new Float32Array(length);
    arr.fill(peak);
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

// ============ 假 OfflineAudioContext ============

/** 参数自动化事件。 */
interface ParamEvent {
  kind: 'set' | 'ramp';
  value: number;
  time: number;
}

/** 假 AudioParam。 */
class FakeAudioParam {
  value = 1;

  readonly events: ParamEvent[] = [];

  setValueAtTime(value: number, time: number): FakeAudioParam {
    this.events.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.events.push({ kind: 'ramp', value, time });
    return this;
  }

  cancelScheduledValues(): void {
    /* no-op */
  }

  cancelAndHoldAtTime(): void {
    /* no-op */
  }
}

/** 假节点。 */
class FakeNode {
  readonly connected: FakeNode[] = [];

  connect(target: FakeNode): FakeNode {
    this.connected.push(target);
    return target;
  }

  disconnect(): void {
    this.connected.length = 0;
  }
}

/** 假 GainNode。 */
class FakeGainNode extends FakeNode {
  readonly gain = new FakeAudioParam();
}

/** `start()` 的调用记录。 */
interface StartCall {
  when: number;
  offset: number;
  duration: number | undefined;
}

/** 假 AudioBufferSourceNode。 */
class FakeBufferSourceNode extends FakeNode {
  buffer: unknown = null;

  readonly playbackRate = new FakeAudioParam();

  readonly startCalls: StartCall[] = [];

  readonly stopCalls: number[] = [];

  start(when?: number, offset?: number, duration?: number): void {
    this.startCalls.push({
      when: when ?? 0,
      offset: offset ?? 0,
      duration,
    });
  }

  stop(when?: number): void {
    this.stopCalls.push(when ?? 0);
  }
}

/** 假 OfflineAudioContext：能真实模拟「按排程把声音写进输出缓冲区」。 */
class FakeOfflineContext {
  readonly destination = new FakeNode();

  readonly gains: FakeGainNode[] = [];

  readonly sources: FakeBufferSourceNode[] = [];

  /** 解码成功的素材 id 集合；其余素材解码失败。 */
  readonly decodable = new Set<string>();

  /** 素材 id → 素材时长（秒）。 */
  readonly durations = new Map<string, number>();

  /** 渲染失败时抛错。 */
  renderError: Error | null = null;

  constructor(
    readonly channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.sources.push(node);
    return node;
  }

  async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    const assetId = new TextDecoder().decode(data);
    if (!this.decodable.has(assetId)) {
      throw new Error(`无法解码：${assetId}`);
    }
    const duration = this.durations.get(assetId) ?? 10;
    return makeAudioBuffer(1, Math.round(duration * this.sampleRate), this.sampleRate, 1);
  }

  /**
   * 模拟渲染：把每个 source 的 `[start(when), stop]` 区间写成满幅样本。
   *
   * 这样「时间映射对不对」就能在单测里被**直接观测**，而不只是断言调用参数。
   */
  async startRendering(): Promise<AudioBuffer> {
    if (this.renderError) throw this.renderError;

    const data: Float32Array[] = [];
    for (let c = 0; c < this.channels; c += 1) {
      data.push(new Float32Array(this.length));
    }

    for (const source of this.sources) {
      const call = source.startCalls[0];
      if (!call) continue;
      const stopTime = source.stopCalls[0] ?? call.when + (call.duration ?? 0);
      const from = Math.max(0, Math.round(call.when * this.sampleRate));
      const to = Math.min(this.length, Math.round(stopTime * this.sampleRate));
      for (let i = from; i < to; i += 1) {
        for (const channel of data) channel[i] = 1;
      }
    }

    return {
      numberOfChannels: this.channels,
      length: this.length,
      sampleRate: this.sampleRate,
      duration: this.length / this.sampleRate,
      getChannelData: (c: number) => data[c] ?? new Float32Array(this.length),
    } as unknown as AudioBuffer;
  }
}

/** 造一个「素材字节读取器」：字节内容就是素材 id。 */
function makeReader(ids: string[]): (assetId: string) => Promise<ArrayBuffer | null> {
  const known = new Set(ids);
  return async (assetId: string) => {
    if (!known.has(assetId)) return null;
    return new TextEncoder().encode(assetId).buffer as ArrayBuffer;
  };
}

/** 把假上下文包装成注入用的工厂。 */
function factoryFor(
  context: FakeOfflineContext,
): (channels: number, length: number, sampleRate: number) => OfflineRenderContext {
  return () => context as unknown as OfflineRenderContext;
}

// ============ 用例 ============

describe('services/export/offlineAudioRenderer', () => {
  describe('时间映射（纯函数）', () => {
    it('speed = 1：源区间 [0, 3000] 放在 startMs = 1000 → 播放区间为时间线 1s~4s', () => {
      const scheduling = resolveClipScheduling(
        makeClip({ startMs: 1000, durationMs: 3000, inMs: 0, outMs: 3000, speed: 1 }),
      );

      expect(scheduling.whenSec).toBe(1);
      expect(scheduling.offsetSec).toBe(0);
      // duration 是**素材时长**（秒），不是播放时长
      expect(scheduling.durationSec).toBe(3);
      expect(scheduling.playbackRate).toBe(1);
      expect(scheduling.timelineDurationSec).toBe(3);
      expect(scheduling.stopSec).toBe(4);
    });

    it('speed = 2：源区间 [0, 3000] 放在 startMs = 0 → 源 3 秒被压到时间线 1.5 秒', () => {
      const scheduling = resolveClipScheduling(
        makeClip({ startMs: 0, durationMs: 1500, inMs: 0, outMs: 3000, speed: 2 }),
      );

      expect(scheduling.whenSec).toBe(0);
      expect(scheduling.offsetSec).toBe(0);
      expect(scheduling.durationSec).toBe(3);
      expect(scheduling.playbackRate).toBe(2);
      expect(scheduling.timelineDurationSec).toBe(1.5);
      expect(scheduling.stopSec).toBe(1.5);
      // 不变式：素材时长 / 速率 === 时间线时长
      expect(scheduling.durationSec / scheduling.playbackRate).toBe(
        scheduling.timelineDurationSec,
      );
    });

    it('speed = 0.5：源 3 秒被拉长到时间线 6 秒', () => {
      const scheduling = resolveClipScheduling(
        makeClip({ startMs: 2000, durationMs: 6000, inMs: 1000, outMs: 4000, speed: 0.5 }),
      );

      expect(scheduling.whenSec).toBe(2);
      expect(scheduling.offsetSec).toBe(1);
      expect(scheduling.durationSec).toBe(3);
      expect(scheduling.playbackRate).toBe(0.5);
      expect(scheduling.timelineDurationSec).toBe(6);
      expect(scheduling.stopSec).toBe(8);
    });

    it('不变式成立时，stopSec - whenSec 恰好等于时间线时长', () => {
      for (const speed of [0.5, 1, 2, 4]) {
        const sourceMs = 3000;
        const durationMs = Math.round(sourceMs / speed);
        const scheduling = resolveClipScheduling(
          makeClip({ startMs: 500, durationMs, inMs: 0, outMs: sourceMs, speed }),
        );
        expect(scheduling.stopSec - scheduling.whenSec).toBeCloseTo(durationMs / 1000, 9);
        expect(scheduling.durationSec / scheduling.playbackRate).toBeCloseTo(
          scheduling.timelineDurationSec,
          9,
        );
      }
    });

    it('不变式被破坏时，停止时刻不会超出素材能支撑的范围', () => {
      // durationMs 被改成 10 秒，但素材只有 3 秒 → 只能播 3 / speed 秒
      const scheduling = resolveClipScheduling(
        makeClip({ startMs: 0, durationMs: 10_000, inMs: 0, outMs: 3000, speed: 1 }),
      );

      expect(scheduling.stopSec).toBe(3);
    });

    it('非法 speed（0 / 负数 / NaN）退化为 1，不产生除零', () => {
      expect(resolveClipScheduling(makeClip({ speed: 0 })).playbackRate).toBe(1);
      expect(resolveClipScheduling(makeClip({ speed: -2 })).playbackRate).toBe(1);
      expect(resolveClipScheduling(makeClip({ speed: Number.NaN })).playbackRate).toBe(1);
    });
  });

  describe('可发声片段判定', () => {
    it('普通音频片段算可发声', () => {
      expect(hasAudibleAudio(makeDoc([makeClip()]))).toBe(true);
    });

    it('片段自身静音 → 不可发声', () => {
      const doc = makeDoc([
        makeClip({ audio: { muted: true, gain: 1, fadeInMs: 0, fadeOutMs: 0 } }),
      ]);
      expect(hasAudibleAudio(doc)).toBe(false);
    });

    it('轨道静音 → 不可发声', () => {
      expect(hasAudibleAudio(makeDoc([makeClip()], { muted: true }))).toBe(false);
    });

    it('没有素材 / 时长为 0 的片段 → 不可发声', () => {
      expect(hasAudibleAudio(makeDoc([makeClip({ assetId: null })]))).toBe(false);
      expect(hasAudibleAudio(makeDoc([makeClip({ durationMs: 0 })]))).toBe(false);
    });

    it('素材 id 收集：去重、排除无素材片段', () => {
      const doc = makeDoc([
        makeClip({ id: 'clip_1', assetId: 'asset_1' }),
        makeClip({ id: 'clip_2', assetId: 'asset_1' }),
        makeClip({ id: 'clip_3', assetId: 'asset_2' }),
        makeClip({ id: 'clip_4', assetId: null }),
      ]);

      expect(collectMixableAssetIds(doc)).toEqual(['asset_1', 'asset_2']);
    });
  });

  describe('主音量', () => {
    it('缺省为 1', () => {
      expect(resolveExportMasterGain(makeDoc([]))).toBe(1);
    });

    it('读取 settings.masterGain 并夹紧到 [0, 2]', () => {
      const doc = makeDoc([]);
      const withGain = {
        ...doc,
        settings: { ...doc.settings, masterGain: 0.5 },
      };
      expect(resolveExportMasterGain(withGain)).toBe(0.5);

      const tooLoud = { ...doc, settings: { ...doc.settings, masterGain: 9 } };
      expect(resolveExportMasterGain(tooLoud)).toBe(2);

      const negative = { ...doc, settings: { ...doc.settings, masterGain: -3 } };
      expect(resolveExportMasterGain(negative)).toBe(0);
    });

    it('与预览侧口径一致：缺省 1、夹紧 [0, 2]、非有限值退化为 1', () => {
      // 预览侧的实现是 `previewAudio.resolveMasterGain`，两边必须同口径。
      // 这里不静态 import 预览模块，是为了让导出链路的提交**自洽**（不依赖尚未落地的模块）。
      const doc = makeDoc([]);
      expect(resolveExportMasterGain(doc)).toBe(1);
      expect(resolveExportMasterGain({ ...doc, settings: { ...doc.settings } })).toBe(1);

      const withGain = (value: unknown) => ({
        ...doc,
        settings: { ...doc.settings, masterGain: value },
      });
      expect(resolveExportMasterGain(withGain(0.35))).toBe(0.35);
      expect(resolveExportMasterGain(withGain(0))).toBe(0);
      expect(resolveExportMasterGain(withGain(2))).toBe(2);
      expect(resolveExportMasterGain(withGain(5))).toBe(2);
      expect(resolveExportMasterGain(withGain(-1))).toBe(0);
      expect(resolveExportMasterGain(withGain(Number.NaN))).toBe(1);
      expect(resolveExportMasterGain(withGain('x'))).toBe(1);
    });
  });

  describe('峰值检测', () => {
    it('全零 → 0；有样本 → 最大绝对值', () => {
      const silent = makeAudioBuffer(1, 128, 48_000, 0);
      expect(peakAmplitude(silent)).toBe(0);

      const loud = makeAudioBuffer(1, 128, 48_000, 0.42);
      expect(peakAmplitude(loud)).toBeCloseTo(0.42, 6);
    });
  });

  describe('离线混音渲染', () => {
    it('把每个片段排到正确的时间线位置', async () => {
      const doc = makeDoc([
        makeClip({ id: 'clip_1', startMs: 1000, durationMs: 3000, inMs: 0, outMs: 3000 }),
      ]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      context.decodable.add('asset_1');
      context.durations.set('asset_1', 5);

      const result = await renderOfflineMix(doc, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: makeReader(['asset_1']),
      });

      expect(result.buffer).not.toBeNull();
      expect(result.mixedClipCount).toBe(1);

      const source = context.sources[0];
      expect(source?.startCalls[0]).toEqual({ when: 1, offset: 0, duration: 3 });
      expect(source?.stopCalls[0]).toBe(4);
      expect(source?.playbackRate.value).toBe(1);

      // 声音确实出现在时间线 1s~4s
      const channel = result.buffer?.getChannelData(0) as Float32Array;
      const sampleRate = 48_000;
      expect(channel[Math.round(0.5 * sampleRate)]).toBe(0);
      expect(channel[Math.round(1.5 * sampleRate)]).toBe(1);
      expect(channel[Math.round(3.5 * sampleRate)]).toBe(1);
      expect(channel[Math.round(4.5 * sampleRate)]).toBe(0);
    });

    it('speed = 2 时，源 3 秒被压到时间线 1.5 秒', async () => {
      const doc = makeDoc([
        makeClip({ id: 'clip_1', startMs: 0, durationMs: 1500, inMs: 0, outMs: 3000, speed: 2 }),
      ]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      context.decodable.add('asset_1');
      context.durations.set('asset_1', 5);

      const result = await renderOfflineMix(doc, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: makeReader(['asset_1']),
      });

      const source = context.sources[0];
      expect(source?.playbackRate.value).toBe(2);
      expect(source?.startCalls[0]).toEqual({ when: 0, offset: 0, duration: 3 });
      expect(source?.stopCalls[0]).toBe(1.5);

      const channel = result.buffer?.getChannelData(0) as Float32Array;
      const sampleRate = 48_000;
      expect(channel[Math.round(0.5 * sampleRate)]).toBe(1);
      expect(channel[Math.round(1.4 * sampleRate)]).toBe(1);
      expect(channel[Math.round(1.6 * sampleRate)]).toBe(0);
    });

    it('变速片段会给出「无法保音高」的显式告警', async () => {
      const doc = makeDoc([
        makeClip({ id: 'clip_1', speed: 2, durationMs: 500, outMs: 1000 }),
      ]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      context.decodable.add('asset_1');

      const result = await renderOfflineMix(doc, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: makeReader(['asset_1']),
      });

      expect(result.warnings.some((warning) => warning.includes('保音高'))).toBe(true);
      expect(result.warnings.some((warning) => warning.includes('变调'))).toBe(true);
    });

    it('淡入淡出被排到片段的时间线上（绝对时间轴）', async () => {
      const doc = makeDoc([
        makeClip({
          id: 'clip_1',
          startMs: 1000,
          durationMs: 3000,
          inMs: 0,
          outMs: 3000,
          audio: { muted: false, gain: 1, fadeInMs: 500, fadeOutMs: 500 },
        }),
      ]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      context.decodable.add('asset_1');

      await renderOfflineMix(doc, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: makeReader(['asset_1']),
      });

      // 找带 ramp 事件的增益节点（包络节点）
      const envelope = context.gains.find((gain) => gain.gain.events.length > 0);
      expect(envelope).toBeDefined();
      const events = envelope?.gain.events ?? [];
      // 淡入：t=1.0 处置 0，1.5 处 ramp 到 1
      expect(events[0]).toEqual({ kind: 'set', value: 0, time: 1 });
      expect(events[1]).toEqual({ kind: 'ramp', value: 1, time: 1.5 });
      // 淡出：3.5 处 ramp 到 1（统一调度器对该中间关键帧用 ramp，效果与 set 1 相同），4.0 处 ramp 到 0
      expect(events[2]).toEqual({ kind: 'ramp', value: 1, time: 3.5 });
      expect(events[3]).toEqual({ kind: 'ramp', value: 0, time: 4 });
    });

    it('工程没有音频 → 不渲染、不告警', async () => {
      const doc = makeDoc([]);
      const context = new FakeOfflineContext(2, 48_000, 48_000);

      const result = await renderOfflineMix(doc, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: makeReader([]),
      });

      expect(result.buffer).toBeNull();
      expect(result.hasAudibleClips).toBe(false);
      expect(result.warnings).toEqual([]);
      expect(context.sources).toHaveLength(0);
    });

    it('OfflineAudioContext 不可用 → 明确告警（不静默）', async () => {
      const doc = makeDoc([makeClip()]);

      const result = await renderOfflineMix(doc, {
        createOfflineContext: () => {
          throw new Error('当前浏览器不支持 OfflineAudioContext');
        },
        readAssetBytes: makeReader(['asset_1']),
      });

      expect(result.buffer).toBeNull();
      expect(result.hasAudibleClips).toBe(true);
      expect(result.warnings.some((warning) => warning.includes('OfflineAudioContext'))).toBe(
        true,
      );
    });

    it('素材解码失败 → 告警里点名素材', async () => {
      const doc = makeDoc([makeClip({ assetId: 'asset_bad' })]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);

      const result = await renderOfflineMix(doc, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: makeReader(['asset_bad']),
      });

      expect(result.warnings.some((warning) => warning.includes('asset_bad'))).toBe(true);
      expect(result.mixedClipCount).toBe(0);
    });

    it('渲染抛错 → 明确告警（不静默）', async () => {
      const doc = makeDoc([makeClip()]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      context.decodable.add('asset_1');
      context.renderError = new Error('渲染炸了');

      const result = await renderOfflineMix(doc, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: makeReader(['asset_1']),
      });

      expect(result.buffer).toBeNull();
      expect(result.hasAudibleClips).toBe(true);
      expect(result.warnings.some((warning) => warning.includes('渲染炸了'))).toBe(true);
    });

    it('渲染结果静音 → 告警说明「导出结果将没有声音」', async () => {
      const doc = makeDoc([makeClip()]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      context.decodable.add('asset_1');
      // 让 source 不产生任何样本（stop 早于 start）
      const originalStart = FakeBufferSourceNode.prototype.start;
      FakeBufferSourceNode.prototype.start = function start(
        when?: number,
        offset?: number,
        duration?: number,
      ): void {
        originalStart.call(this, when, offset, duration);
        this.stopCalls.length = 0;
        this.stopCalls.push(-1);
      };

      try {
        const result = await renderOfflineMix(doc, {
          createOfflineContext: factoryFor(context),
          readAssetBytes: makeReader(['asset_1']),
        });

        expect(result.silent).toBe(true);
        expect(result.peak).toBe(0);
        expect(result.warnings.some((warning) => warning.includes('静音'))).toBe(true);
      } finally {
        FakeBufferSourceNode.prototype.start = originalStart;
      }
    });

    it('主音量写进混音总线', async () => {
      const doc = makeDoc([makeClip()]);
      const withGain = {
        ...doc,
        settings: { ...doc.settings, masterGain: 0.5 },
      };
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      context.decodable.add('asset_1');

      await renderOfflineMix(withGain, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: makeReader(['asset_1']),
      });

      // gains[0] 是 buildAudioGraph 创建的 masterGain
      expect(context.gains[0]?.gain.value).toBe(0.5);
    });

    it('同一素材被多个片段引用时只解码一次', async () => {
      const doc = makeDoc([
        makeClip({ id: 'clip_1', assetId: 'asset_1', startMs: 0, durationMs: 1000 }),
        makeClip({ id: 'clip_2', assetId: 'asset_1', startMs: 2000, durationMs: 1000 }),
      ]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      context.decodable.add('asset_1');

      let decodeCalls = 0;
      const reader = async (assetId: string): Promise<ArrayBuffer | null> => {
        decodeCalls += 1;
        return new TextEncoder().encode(assetId).buffer as ArrayBuffer;
      };

      const result = await renderOfflineMix(doc, {
        createOfflineContext: factoryFor(context),
        readAssetBytes: reader,
      });

      expect(decodeCalls).toBe(1);
      expect(result.mixedClipCount).toBe(2);
      expect(context.sources).toHaveLength(2);
    });

    it('取消信号在解码前被检查', async () => {
      const doc = makeDoc([makeClip()]);
      const context = new FakeOfflineContext(2, 48_000 * 10, 48_000);
      const controller = new AbortController();
      controller.abort();

      await expect(
        renderOfflineMix(doc, {
          createOfflineContext: factoryFor(context),
          readAssetBytes: makeReader(['asset_1']),
          signal: controller.signal,
        }),
      ).rejects.toThrowError('导出已取消');
    });
  });
});
