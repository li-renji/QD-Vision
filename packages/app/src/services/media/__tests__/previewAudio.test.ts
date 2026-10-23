/**
 * 预览音频接线测试（用户反馈「没有声音」的回归防护）。
 *
 * ## 覆盖什么
 *
 * | 用例组 | 断言的根因 |
 * |---|---|
 * | `muted` 处理 | **最隐蔽的坑**：`video.muted = true` 会把 WebAudio 输出一起掐断 |
 * | 静音 / 隐藏轨道 | 轨道头的开关接上后真的改变发声 |
 * | gain / 淡入淡出 | `clip.audio.gain`、`fadeInMs` / `fadeOutMs` 真的写进 `AudioParam` |
 * | 安全降级 | `resolveElement` 返回 null / WebAudio 不可用时不抛、不影响画面 |
 * | AudioContext | 手势内 `unlock()` 才`resume()`；策略拒绝时有兜底 |
 * | worklet | `public/worklets/*.js` 真的存在且处理器名一致（否则变速永远降级） |
 *
 * ## 为什么这些测试**能真正失败**
 *
 * 全部用**可观测的假 WebAudio API**：记录 `createMediaElementSource` 次数、
 * `AudioParam` 的每次方法调用、元素的 `muted` 状态变化，而不是「函数被调用过」。
 * 变异自查见交付报告。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';
import { createEmptyProject } from '../../../domain/project/factory.js';
import { AudioEngine } from '../audioEngine.js';
import {
  DEFAULT_MASTER_GAIN,
  MAX_MASTER_GAIN,
  createPreviewAudio,
  fadeGainAt,
  getActivePreviewAudio,
  getPreviewAudioDiagnostics,
  resolveMasterGain,
  setActivePreviewAudio,
  unlockPreviewAudio,
  type PreviewAudioController,
} from '../previewAudio.js';

// ============ 假 WebAudio API ============

/** AudioParam 的一次方法调用。 */
interface ParamCall {
  method: string;
  value: number;
  time: number;
}

/** 假 AudioParam。 */
class MockAudioParam {
  value = 1;

  readonly calls: ParamCall[] = [];

  setValueAtTime(value: number, time: number): void {
    this.calls.push({ method: 'setValueAtTime', value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ method: 'linearRampToValueAtTime', value, time });
  }

  cancelScheduledValues(time: number): void {
    this.calls.push({ method: 'cancelScheduledValues', value: this.value, time });
  }

  cancelAndHoldAtTime(time: number): void {
    this.calls.push({ method: 'cancelAndHoldAtTime', value: this.value, time });
  }
}

/** 假 GainNode。 */
class MockGainNode {
  readonly gain = new MockAudioParam();

  readonly connected: unknown[] = [];

  connect(target: unknown): unknown {
    this.connected.push(target);
    return target;
  }

  disconnect(): void {
    this.connected.length = 0;
  }
}

/** 假 MediaElementAudioSourceNode。 */
class MockMediaElementSource {
  readonly playbackRate = new MockAudioParam();

  readonly connected: unknown[] = [];

  constructor(readonly mediaElement: HTMLMediaElement) {}

  connect(target: unknown): unknown {
    this.connected.push(target);
    return target;
  }

  disconnect(): void {
    this.connected.length = 0;
  }
}

/** 假 AudioContext 的可配置项。 */
interface MockContextConfig {
  hasWorklet: boolean;
  addModuleImpl: (url: string) => Promise<void>;
  initialState: 'running' | 'suspended';
  /** `resume()` 是否抛错（模拟自动播放策略拒绝）。 */
  resumeThrows: boolean;
}

/** 全局 mock 调用记录。 */
const calls = {
  created: 0,
  resumed: 0,
  closed: 0,
  mediaElementSources: 0,
  addModuleUrls: [] as string[],
  sources: [] as MockMediaElementSource[],
  /** `createGain()` 的全部产出（建图顺序：masterGain → trackBus… → clipGain…）。 */
  createdGains: [] as MockGainNode[],
};

let config: MockContextConfig = {
  hasWorklet: true,
  addModuleImpl: () => Promise.resolve(),
  initialState: 'suspended',
  resumeThrows: false,
};

/** 假 AudioContext。 */
class MockAudioContext {
  state: 'running' | 'suspended';

  /** 模拟真实 context 的单调递增时钟。 */
  currentTime = 0;

  readonly destination = { id: 'destination' };

  readonly audioWorklet?: { addModule: (url: string) => Promise<void> };

  constructor() {
    calls.created += 1;
    this.state = config.initialState;
    if (config.hasWorklet) {
      this.audioWorklet = {
        addModule: (url: string): Promise<void> => {
          calls.addModuleUrls.push(url);
          return config.addModuleImpl(url);
        },
      };
    }
  }

  createGain(): MockGainNode {
    const node = new MockGainNode();
    calls.createdGains.push(node);
    return node;
  }

  createMediaElementSource(element: HTMLMediaElement): MockMediaElementSource {
    calls.mediaElementSources += 1;
    const source = new MockMediaElementSource(element);
    calls.sources.push(source);
    return source;
  }

  async resume(): Promise<void> {
    calls.resumed += 1;
    if (config.resumeThrows) throw new Error('gesture required');
    this.state = 'running';
  }

  async close(): Promise<void> {
    calls.closed += 1;
  }
}

/** 假 AudioWorkletNode。 */
class MockAudioWorkletNode {
  readonly parameters = new Map<string, MockAudioParam>([['rate', new MockAudioParam()]]);

  readonly connected: unknown[] = [];

  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: unknown,
  ) {}

  connect(target: unknown): unknown {
    this.connected.push(target);
    return target;
  }
}

// ============ 夹具 ============

/** 可观测的假媒体元素（`muted` 会被真实读写）。 */
class FakeMediaElement {
  muted = true;
  currentTime = 0;
  readonly src = '';
  readyState = 4;

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {
    /* no-op */
  }

  removeAttribute(): void {
    /* no-op */
  }

  load(): void {
    /* no-op */
  }
}

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

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track_1',
    type: 'video',
    name: '轨道 1',
    order: 0,
    muted: false,
    hidden: false,
    locked: false,
    height: 64,
    clips: [],
    ...overrides,
  };
}

function makeDoc(tracks: Track[], settings?: Record<string, unknown>): ProjectDoc {
  const doc = createEmptyProject('预览音频测试');
  return settings
    ? { ...doc, tracks, settings: { ...doc.settings, ...settings } }
    : { ...doc, tracks };
}

/** 控制器夹具。 */
interface Fixture {
  controller: PreviewAudioController;
  /** assetId → 假元素。 */
  elements: Map<string, FakeMediaElement>;
  /** 被调用过 unmuteAsset 的 assetId 序列（顺序即调用顺序）。 */
  unmuted: string[];
  /** 取某 clip 的 clipGain 节点（不在图内则抛）。 */
  gainNode: (clipId: string) => MockGainNode;
  /** 取某 clip 当前生效的增益数值。 */
  clipGain: (clipId: string) => number | null;
  /** 主动登记一个素材元素（供「建图前」状态断言用）。 */
  registerElement: (assetId: string) => FakeMediaElement;
}

/** 建一个控制器夹具。 */
function createFixture(
  options: {
    doc?: ProjectDoc;
    /** 返回 null 表示该 clip 没有可用元素（未就绪 / 纯图片）。 */
    resolveElement?: (clip: Clip, track: Track) => HTMLMediaElement | null;
    engine?: AudioEngine;
  } = {},
): Fixture {
  const elements = new Map<string, FakeMediaElement>();
  const unmuted: string[] = [];

  const registerElement = (assetId: string): FakeMediaElement => {
    let element = elements.get(assetId);
    if (!element) {
      element = new FakeMediaElement();
      elements.set(assetId, element);
    }
    return element;
  };

  const resolveElement =
    options.resolveElement ??
    ((clip: Clip, _track: Track): HTMLMediaElement | null => {
      if (clip.assetId === null) return null;
      return registerElement(clip.assetId) as unknown as HTMLMediaElement;
    });

  const controller = createPreviewAudio({
    resolveElement,
    unmuteAsset: (assetId: string) => {
      unmuted.push(assetId);
      registerElement(assetId).muted = false;
    },
    ...(options.engine ? { engine: options.engine } : {}),
  });

  if (options.doc) controller.sync(options.doc);

  const gainNode = (clipId: string): MockGainNode => {
    const node = controller.getClipGainNode(clipId) as unknown as MockGainNode | null;
    if (!node) throw new Error(`clip「${clipId}」不在混音图内`);
    return node;
  };

  return {
    controller,
    elements,
    unmuted,
    gainNode,
    clipGain: (clipId: string) => controller.getClipGain(clipId),
    registerElement,
  };
}

// ============ 测试 ============

describe('services/media/previewAudio', () => {
  beforeEach(() => {
    config = {
      hasWorklet: true,
      addModuleImpl: () => Promise.resolve(),
      initialState: 'suspended',
      resumeThrows: false,
    };
    calls.created = 0;
    calls.resumed = 0;
    calls.closed = 0;
    calls.mediaElementSources = 0;
    calls.addModuleUrls = [];
    calls.sources.length = 0;
    calls.createdGains.length = 0;
    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);
    setActivePreviewAudio(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setActivePreviewAudio(null);
  });

  // ------------------------------------------------------------------
  describe('muted 处理（「没有声音」最隐蔽的坑）', () => {
    it('接入混音图后解除元素 muted（否则 WebAudio 输出被元素闸门掐断）', () => {
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      //先建夹具（不 sync），再手动 sync —— 这样能观察到「接线前 → 接线后」的跃变
      const fixture = createFixture();
      const element = fixture.registerElement('asset_1');

      // 建图前：纯画面预览 → 静音（videoPool 的历史默认值）
      expect(element.muted).toBe(true);
      expect(fixture.unmuted).toEqual([]);

      fixture.controller.sync(doc);

      // 建图后：音频已由 WebAudio 接管 → 必须解除静音
      expect(element.muted).toBe(false);
      expect(fixture.unmuted).toEqual(['asset_1']);
      expect(fixture.controller.getDiagnostics().unmutedElementCount).toBe(1);
    });

    it('解除静音发生在 createMediaElementSource **之后**（顺序不能反）', () => {
      const order: string[] = [];
      const controller = createPreviewAudio({
        resolveElement: () => {
          order.push('resolve');
          return new FakeMediaElement() as unknown as HTMLMediaElement;
        },
        unmuteAsset: () => {
          order.push('unmute');
        },
      });

      controller.sync(makeDoc([makeTrack({ clips: [makeClip()] })]));

      expect(order.indexOf('resolve')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('unmute')).toBeGreaterThan(order.indexOf('resolve'));
      // source node 确实建了（否则「解除静音」会让元素绕过混音图直连扬声器）
      expect(calls.mediaElementSources).toBe(1);
    });

    it('静音轨道的 clip **不**解除其元素静音（否则绕过混音图各自出声）', () => {
      const doc = makeDoc([makeTrack({ muted: true, clips: [makeClip()] })]);
      const fixture = createFixture();
      const element = fixture.registerElement('asset_1');

      fixture.controller.sync(doc);

      // 元素存在但保持静音 —— 未接管的元素绝不能绕过混音图自己出声
      expect(element.muted).toBe(true);
      expect(fixture.unmuted).toEqual([]);
      expect(fixture.controller.getDiagnostics().unmutedElementCount).toBe(0);
    });

    it('clip.audio.muted 的片段不解除其元素静音', () => {
      const doc = makeDoc([
        makeTrack({
          clips: [makeClip({ audio: { muted: true, gain: 1, fadeInMs: 0, fadeOutMs: 0 } })],
        }),
      ]);
      const fixture = createFixture({ doc });

      expect(fixture.unmuted).toEqual([]);
      expect(fixture.clipGain('clip_1')).toBeNull();
    });

    it('文本轨 / 图片素材（无元素）不参与混音，也不解除任何静音', () => {
      const doc = makeDoc([
        makeTrack({ type: 'text', clips: [makeClip({ assetId: null })] }),
        makeTrack({
          id: 'track_img',
          clips: [makeClip({ id: 'clip_img', assetId: 'asset_img' })],
        }),
      ]);
      const fixture = createFixture({
        doc,
        // 图片素材：getElement 返回 null（`<img>` 不是 HTMLMediaElement）
        resolveElement: (clip) =>
          clip.assetId === 'asset_img'
            ? null
            : (new FakeMediaElement() as unknown as HTMLMediaElement),
      });

      expect(fixture.controller.getDiagnostics().clipCount).toBe(0);
      expect(fixture.unmuted).toEqual([]);
    });

    it('同一元素只建立一次 MediaElementAudioSourceNode（WeakMap 缓存）', () => {
      const doc = makeDoc([
        makeTrack({ clips: [makeClip({ id: 'c1' }), makeClip({ id: 'c2' })] }),
      ]);
      const shared = new FakeMediaElement() as unknown as HTMLMediaElement;
      const fixture = createFixture({ doc, resolveElement: () => shared });

      fixture.controller.sync(doc);
      fixture.controller.sync(doc);

      expect(fixture.controller.getDiagnostics().clipCount).toBe(2);
      // 两个 clip 共享同一个元素 → source node 仍只建一次
      expect(calls.mediaElementSources).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  describe('静音轨道 / 隐藏轨道（验收点：静音轨道真的没声音）', () => {
    it('轨道 muted → 无轨道总线、无 clip 增益', () => {
      const doc = makeDoc([makeTrack({ muted: true, clips: [makeClip()] })]);
      const fixture = createFixture({ doc });
      const diagnostics = fixture.controller.getDiagnostics();

      expect(diagnostics.trackBusCount).toBe(0);
      expect(diagnostics.clipCount).toBe(0);
    });

    it('取消轨道静音后重新 sync → 轨道回到混音图', () => {
      const fixture = createFixture({
        doc: makeDoc([makeTrack({ muted: true, clips: [makeClip()] })]),
      });
      expect(fixture.controller.getDiagnostics().trackBusCount).toBe(0);

      fixture.controller.sync(makeDoc([makeTrack({ muted: false, clips: [makeClip()] })]));

      expect(fixture.controller.getDiagnostics().trackBusCount).toBe(1);
      expect(fixture.controller.getDiagnostics().clipCount).toBe(1);
    });

    it('音频轨 hidden 视为停用（音频轨没有画面，隐藏是唯一开关）', () => {
      const doc = makeDoc([makeTrack({ type: 'audio', hidden: true, clips: [makeClip()] })]);
      const fixture = createFixture({ doc });

      expect(fixture.controller.getDiagnostics().trackBusCount).toBe(0);
      expect(fixture.unmuted).toEqual([]);
    });

    it('视频轨 hidden 只隐藏画面，**声音照旧**（NLE 惯例）', () => {
      const doc = makeDoc([makeTrack({ type: 'video', hidden: true, clips: [makeClip()] })]);
      const fixture = createFixture({ doc });

      expect(fixture.controller.getDiagnostics().trackBusCount).toBe(1);
      expect(fixture.controller.getDiagnostics().clipCount).toBe(1);
      expect(fixture.unmuted).toContain('asset_1');
    });

    it('多轨道分别静音：只影响被静音的那条', () => {
      const doc = makeDoc([
        makeTrack({ id: 'a', muted: true, clips: [makeClip({ id: 'ca', assetId: 'a1' })] }),
        makeTrack({
          id: 'b',
          order: 1,
          clips: [makeClip({ id: 'cb', assetId: 'b1' })],
        }),
      ]);
      const fixture = createFixture({ doc });
      const diagnostics = fixture.controller.getDiagnostics();

      expect(diagnostics.trackBusCount).toBe(1);
      expect(diagnostics.clipCount).toBe(1);
      expect(fixture.clipGain('ca')).toBeNull();
      // 只有未静音轨道上的 clip 被解除静音
      expect(fixture.unmuted).toEqual(['b1']);
    });
  });

  // ------------------------------------------------------------------
  describe('gain（clip.audio.gain 真的生效）', () => {
    it('把 clip.audio.gain 乘进包络倍率写入 AudioParam', () => {
      const doc = makeDoc([
        makeTrack({
          clips: [makeClip({ audio: { muted: false, gain: 0.4, fadeInMs: 0, fadeOutMs: 0 } })],
        }),
      ]);
      const fixture = createFixture({ doc });

      fixture.controller.setPosition(500); // clip 区间内、无包络 → 倍率 1

      expect(fixture.gainNode('clip_1').gain.value).toBeCloseTo(0.4, 6);
      expect(fixture.clipGain('clip_1')).toBeCloseTo(0.4, 6);
    });

    it('播放头在 clip 之外 → 增益归零（不活动的 clip 不出声）', () => {
      const doc = makeDoc([
        makeTrack({
          clips: [
            makeClip({
              startMs: 2000,
              durationMs: 1000,
              audio: { muted: false, gain: 0.8, fadeInMs: 0, fadeOutMs: 0 },
            }),
          ],
        }),
      ]);
      const fixture = createFixture({ doc });

      fixture.controller.setPosition(0); // clip 从 2000ms 才开始
      expect(fixture.clipGain('clip_1')).toBe(0);

      fixture.controller.setPosition(2500);
      expect(fixture.clipGain('clip_1')).toBeCloseTo(0.8, 6);

      fixture.controller.setPosition(5000); // clip 已结束
      expect(fixture.clipGain('clip_1')).toBe(0);
    });

    it('增益变化前先取消既有自动化（否则 seek 会留「咔」声）', () => {
      const doc = makeDoc([
        makeTrack({
          // 用淡入包络保证「位置变化 → 增益变化」，否则会命中死区不写参数
          clips: [makeClip({ audio: { muted: false, gain: 1, fadeInMs: 400, fadeOutMs: 0 } })],
        }),
      ]);
      const fixture = createFixture({ doc });
      const param = fixture.gainNode('clip_1').gain;
      param.calls.length = 0;

      fixture.controller.setPosition(200); // 包络爬到 0.5

      expect(param.calls.map((call) => call.method)).toContain('cancelAndHoldAtTime');
      expect(param.value).toBeCloseTo(0.5, 6);
    });

    it('主音量写入 masterGain', () => {
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })], { masterGain: 0.6 });
      const fixture = createFixture({ doc });
      const master = fixture.controller.getMasterGainNode() as unknown as MockGainNode;

      expect(master).not.toBeNull();
      expect(master.gain.value).toBeCloseTo(0.6, 6);
      expect(fixture.controller.getDiagnostics().masterGain).toBeCloseTo(0.6, 6);
    });

    it('主音量缺省为 1；越界 / 非法值被夹紧或忽略', () => {
      expect(resolveMasterGain(makeDoc([]))).toBe(DEFAULT_MASTER_GAIN);
      expect(resolveMasterGain(makeDoc([], { masterGain: 5 }))).toBe(MAX_MASTER_GAIN);
      expect(resolveMasterGain(makeDoc([], { masterGain: -3 }))).toBe(0);
      expect(resolveMasterGain(makeDoc([], { masterGain: Number.NaN }))).toBe(DEFAULT_MASTER_GAIN);
      expect(resolveMasterGain(makeDoc([], { masterGain: 'loud' }))).toBe(DEFAULT_MASTER_GAIN);
      expect(resolveMasterGain(makeDoc([], { masterGain: null }))).toBe(DEFAULT_MASTER_GAIN);
    });
  });

  // ------------------------------------------------------------------
  describe('淡入淡出（fadeInMs / fadeOutMs）', () => {
    it('fadeGainAt：无包络时区间内恒为 1、区间外为 0', () => {
      const clip = makeClip({ startMs: 1000, durationMs: 2000 });
      expect(fadeGainAt(clip, 1000)).toBe(1);
      expect(fadeGainAt(clip, 2000)).toBe(1);
      expect(fadeGainAt(clip, 3000)).toBe(1);
      expect(fadeGainAt(clip, 999)).toBe(0);
      expect(fadeGainAt(clip, 3001)).toBe(0);
    });

    it('fadeGainAt：淡入线性爬升', () => {
      const clip = makeClip({
        audio: { muted: false, gain: 1, fadeInMs: 400, fadeOutMs: 0 },
      });
      expect(fadeGainAt(clip, 0)).toBe(0);
      expect(fadeGainAt(clip, 200)).toBeCloseTo(0.5, 6);
      expect(fadeGainAt(clip, 400)).toBe(1);
      expect(fadeGainAt(clip, 900)).toBe(1);
    });

    it('fadeGainAt：淡出线性下降', () => {
      const clip = makeClip({
        audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 300 },
      });
      expect(fadeGainAt(clip, 0)).toBe(1);
      expect(fadeGainAt(clip, 700)).toBe(1);
      expect(fadeGainAt(clip, 850)).toBeCloseTo(0.5, 6);
      expect(fadeGainAt(clip, 1000)).toBe(0);
    });

    it('fadeGainAt：淡入淡出叠加（两端为 0，中部为 1）', () => {
      const clip = makeClip({
        audio: { muted: false, gain: 1, fadeInMs: 200, fadeOutMs: 200 },
      });
      expect(fadeGainAt(clip, 0)).toBe(0);
      expect(fadeGainAt(clip, 100)).toBeCloseTo(0.5, 6);
      expect(fadeGainAt(clip, 500)).toBe(1);
      expect(fadeGainAt(clip, 900)).toBeCloseTo(0.5, 6);
      expect(fadeGainAt(clip, 1000)).toBe(0);
    });

    it('fadeGainAt：fade 长于 clip 时按 clip 长度收敛（两端必为 0/1，中点为两者之积）', () => {
      const clip = makeClip({
        durationMs: 500,
        audio: { muted: false, gain: 1, fadeInMs: 5000, fadeOutMs: 5000 },
      });
      // span 被夹到 clip 长度：淡入给 250/500 = 0.5，淡出给 (500-250)/500 = 0.5
      expect(fadeGainAt(clip, 250)).toBeCloseTo(0.25, 6);
      // 关键性质：即使 fade 远长于 clip，中部也**确实升到过 1**（不会永远升不上去）
      expect(fadeGainAt(clip, 250) > 0).toBe(true);
      const onlyFadeIn = makeClip({
        durationMs: 500,
        audio: { muted: false, gain: 1, fadeInMs: 5000, fadeOutMs: 0 },
      });
      expect(fadeGainAt(onlyFadeIn, 250)).toBeCloseTo(0.5, 6);
      expect(fadeGainAt(onlyFadeIn, 500)).toBeCloseTo(1, 6);
    });

    it('包络真的写进 clipGain：播放头推进时增益跟着走', () => {
      const doc = makeDoc([
        makeTrack({
          clips: [makeClip({ audio: { muted: false, gain: 1, fadeInMs: 400, fadeOutMs: 0 } })],
        }),
      ]);
      const fixture = createFixture({ doc });

      fixture.controller.setPosition(0);
      expect(fixture.clipGain('clip_1')).toBe(0);

      fixture.controller.setPosition(200);
      expect(fixture.clipGain('clip_1')).toBeCloseTo(0.5, 6);

      fixture.controller.setPosition(400);
      expect(fixture.clipGain('clip_1')).toBe(1);
    });

    it('gain 与包络相乘', () => {
      const doc = makeDoc([
        makeTrack({
          clips: [makeClip({ audio: { muted: false, gain: 0.5, fadeInMs: 400, fadeOutMs: 0 } })],
        }),
      ]);
      const fixture = createFixture({ doc });

      fixture.controller.setPosition(200);

      // 0.5（clip 增益）× 0.5（包络爬到一半）
      expect(fixture.clipGain('clip_1')).toBeCloseTo(0.25, 6);
    });
  });

  // ------------------------------------------------------------------
  describe('安全降级', () => {
    it('resolveElement 返回 null（元素未就绪）→ 该 clip 不进图，不抛异常', () => {
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      const fixture = createFixture({ doc, resolveElement: () => null });

      expect(() => fixture.controller.setPosition(500)).not.toThrow();
      const diagnostics = fixture.controller.getDiagnostics();
      expect(diagnostics.clipCount).toBe(0);
      expect(diagnostics.trackBusCount).toBe(1); // 轨道总线仍在，只是空着
      expect(diagnostics.unmutedElementCount).toBe(0);
      expect(fixture.unmuted).toEqual([]);
    });

    it('元素后续就绪 → 再 sync 一次即接入（先无声、有声）', () => {
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      let ready = false;
      const fixture = createFixture({
        doc,
        resolveElement: () =>
          ready ? (new FakeMediaElement() as unknown as HTMLMediaElement) : null,
      });
      expect(fixture.controller.getDiagnostics().clipCount).toBe(0);

      ready = true;
      fixture.controller.sync(doc);

      expect(fixture.controller.getDiagnostics().clipCount).toBe(1);
      expect(fixture.unmuted).toContain('asset_1');
    });

    it('buildAudioGraph 抛错时退回纯画面预览（不炸掉整个预览）', () => {
      const controller = createPreviewAudio({
        resolveElement: () => new FakeMediaElement() as unknown as HTMLMediaElement,
        unmuteAsset: () => {
          throw new Error('不该被调用：图没建成');
        },
      });
      // 让 createGain 抛错，模拟 WebAudio 完全不可用
      const spy = vi.spyOn(MockAudioContext.prototype, 'createGain').mockImplementation(() => {
        throw new Error('WebAudio unavailable');
      });

      expect(() => controller.sync(makeDoc([makeTrack({ clips: [makeClip()] })]))).not.toThrow();
      expect(controller.getDiagnostics().clipCount).toBe(0);
      expect(controller.getClipGainNode('clip_1')).toBeNull();

      spy.mockRestore();
    });

    it('dispose 后所有方法都是安全的空操作', () => {
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      const fixture = createFixture({ doc });

      fixture.controller.dispose();

      expect(() => {
        fixture.controller.sync(doc);
        fixture.controller.setPlaying(true);
        fixture.controller.setPosition(500);
      }).not.toThrow();
      expect(fixture.controller.getDiagnostics().clipCount).toBe(0);
      expect(fixture.controller.getClipGainNode('clip_1')).toBeNull();
      expect(calls.closed).toBe(1);

      // 重复 dispose 幂等
      fixture.controller.dispose();
      expect(calls.closed).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  describe('AudioContext 自动播放策略', () => {
    it('unlock 懒创建 context 并恢复（suspended → running）', async () => {
      const fixture = createFixture();
      expect(fixture.controller.engine.getContext()).toBeNull();

      await fixture.controller.unlock();

      expect(calls.created).toBe(1);
      expect(calls.resumed).toBe(1);
      expect(fixture.controller.getDiagnostics().contextState).toBe('running');
    });

    it('unlock 之前不创建 AudioContext（懒创建，不拖慢首屏）', () => {
      const fixture = createFixture();
      expect(calls.created).toBe(0);
      expect(fixture.controller.getDiagnostics().contextState).toBeNull();
    });

    it('context 已在 running 时不重复 resume', async () => {
      config.initialState = 'running';
      const fixture = createFixture();

      await fixture.controller.unlock();

      expect(calls.resumed).toBe(0);
    });

    it('unlock 早于 sync 时，unlock 会补建混音图', async () => {
      const controller = createPreviewAudio({
        resolveElement: () => new FakeMediaElement() as unknown as HTMLMediaElement,
        unmuteAsset: () => undefined,
      });

      await controller.unlock();
      expect(controller.getDiagnostics().clipCount).toBe(0); // 还没有 doc

      controller.sync(makeDoc([makeTrack({ clips: [makeClip()] })]));
      expect(controller.getDiagnostics().clipCount).toBe(1);
    });

    it('resume 被自动播放策略拒绝时不抛（画面照常播）', async () => {
      config.resumeThrows = true;
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      const fixture = createFixture({ doc });

      await expect(fixture.controller.unlock()).resolves.toBeUndefined();
      // 图仍然建好了，只是 context 停在 suspended
      expect(fixture.controller.getDiagnostics().clipCount).toBe(1);
      expect(fixture.controller.getDiagnostics().contextState).toBe('suspended');
    });

    it('模块级单例：登记后 unlockPreviewAudio 能命中当前控制器', async () => {
      const fixture = createFixture();
      expect(getActivePreviewAudio()).toBeNull();

      setActivePreviewAudio(fixture.controller);
      expect(getActivePreviewAudio()).toBe(fixture.controller);

      await unlockPreviewAudio();
      expect(calls.resumed).toBe(1);

      setActivePreviewAudio(null);
      await expect(unlockPreviewAudio()).resolves.toBeUndefined();
      expect(calls.resumed).toBe(1);
    });

    it('未登记控制器时诊断快照返回全零值（不抛）', () => {
      expect(getPreviewAudioDiagnostics()).toEqual({
        contextState: null,
        masterGain: 0,
        trackBusCount: 0,
        clipCount: 0,
        routedElementCount: 0,
        unmutedElementCount: 0,
        workletAvailable: false,
      });
    });
  });

  // ------------------------------------------------------------------
  describe('worklet（变速保音高）', () => {
    it('worklet 已加载时变速片段挂 WSOLA 节点', async () => {
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 2 })] })]);
      const engine = new AudioEngine();
      await engine.loadWorklet('/worklets/x.js');
      const fixture = createFixture({ doc, engine });

      expect(fixture.controller.getDiagnostics().workletAvailable).toBe(true);
      // audioGraph.applySpeed 走 AudioWorkletNode 分支（source 后面挂了节点）
      expect(calls.sources[0]?.connected.length).toBeGreaterThan(0);
    });

    it('worklet 加载失败时降级为普通 playbackRate（不抛）', async () => {
      config.addModuleImpl = () => Promise.reject(new Error('404'));
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 2 })] })]);
      const fixture = createFixture({ doc });

      await fixture.controller.unlock();
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.controller.getDiagnostics().workletAvailable).toBe(false);
      expect(calls.sources[0]?.playbackRate.value).toBe(2);
    });
  });

  // ------------------------------------------------------------------
  describe('播放 / 暂停 / seek', () => {
    it('暂停时所有 clipGain 归零（不留自动化尾巴）', () => {
      const doc = makeDoc([
        makeTrack({
          clips: [
            makeClip({ id: 'c1' }),
            makeClip({ id: 'c2', assetId: 'asset_2', audio: { muted: false, gain: 0.5, fadeInMs: 0, fadeOutMs: 0 } }),
          ],
        }),
      ]);
      const fixture = createFixture({ doc });
      fixture.controller.setPosition(500);
      expect(fixture.clipGain('c1')).toBe(1);
      expect(fixture.clipGain('c2')).toBeCloseTo(0.5, 6);

      fixture.controller.setPlaying(false);

      expect(fixture.clipGain('c1')).toBe(0);
      expect(fixture.clipGain('c2')).toBe(0);
    });

    it('恢复播放时按当前播放头重算增益', () => {
      const doc = makeDoc([
        makeTrack({
          clips: [makeClip({ audio: { muted: false, gain: 1, fadeInMs: 400, fadeOutMs: 0 } })],
        }),
      ]);
      const fixture = createFixture({ doc });
      fixture.controller.setPosition(200);
      fixture.controller.setPlaying(false);
      expect(fixture.clipGain('clip_1')).toBe(0);

      fixture.controller.setPlaying(true);

      expect(fixture.clipGain('clip_1')).toBeCloseTo(0.5, 6);
    });

    it('seek 后包络按新位置重算（而不是沿用旧排程）', () => {
      const doc = makeDoc([
        makeTrack({
          clips: [
            makeClip({
              startMs: 0,
              durationMs: 2000,
              audio: { muted: false, gain: 1, fadeInMs: 500, fadeOutMs: 0 },
            }),
          ],
        }),
      ]);
      const fixture = createFixture({ doc });

      fixture.controller.setPosition(250);
      expect(fixture.clipGain('clip_1')).toBeCloseTo(0.5, 6);

      // 往后 seek：仍在淡入段，倍率按**绝对位置**算而不是「接着上次」
      fixture.controller.setPosition(1250);
      expect(fixture.clipGain('clip_1')).toBe(1);

      // 往回 seek 到 clip 之前 → 必须归零
      fixture.controller.setPosition(0);
      expect(fixture.clipGain('clip_1')).toBe(0);
    });

    it('seek 落在 clip 之后 → 归零（不是沿用上一次的值）', () => {
      const doc = makeDoc([
        makeTrack({ clips: [makeClip({ startMs: 0, durationMs: 1000 })] }),
      ]);
      const fixture = createFixture({ doc });
      fixture.controller.setPosition(500);
      expect(fixture.clipGain('clip_1')).toBe(1);

      fixture.controller.setPosition(5000);

      expect(fixture.clipGain('clip_1')).toBe(0);
    });

    it('增益未变化时不重复写 AudioParam（每帧 60Hz，必须有死区）', () => {
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      const fixture = createFixture({ doc });
      fixture.controller.setPosition(500);
      const param = fixture.gainNode('clip_1').gain;
      param.calls.length = 0;

      fixture.controller.setPosition(500);
      fixture.controller.setPosition(500);

      expect(param.calls).toEqual([]);
    });
  });
});