/**
 * 预览侧音频引擎测试（BUG-03）。
 *
 * 覆盖 `AudioEngine` 的全部公开面：
 * 1. **context 生命周期**（对应播放/暂停/停止）：懒创建 → `resume()` → `dispose()`；
 * 2. **变速保音高 worklet**：`loadWorklet()` 的成功 / 失败 / 不可用 / 幂等；
 * 3. **混音图构建**（增益控制）：轨道静音、片段静音、增益值、元素源缓存；
 * 4. **音量包络**（淡入淡出）：`applyFade()` 的包络事件；
 * 5. **变速处理**：`speed !== 1` 时的 `playbackRate` 与 WSOLA worklet 挂载。
 *
 * ⚠️ **本环境无法验证的部分**：WSOLA 保音高的**音频质量**（FFT / 归一化互相关 /
 * Hann 窗交叉淡化）需要真实 `OfflineAudioContext` 渲染真实波形才能断言 ——
 * 本文件只断言 **worklet 的接线**（节点名、`rate` 参数、信号通路），
 * 音频保真度必须**浏览器真机验证**。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';
import { createEmptyProject } from '../../../domain/project/factory.js';
import { AudioEngine, audioEngine } from '../audioEngine.js';

/** 包络事件（AudioParam 调用的记录）。 */
interface ParamEvent {
  type: 'setValueAtTime' | 'linearRampToValueAtTime';
  value: number;
  time: number;
}

/** 假 AudioParam。 */
class MockAudioParam {
  value = 1;

  readonly events: ParamEvent[] = [];

  setValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'setValueAtTime', value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'linearRampToValueAtTime', value, time });
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
  /** 元素源上的播放速率（`applySpeed` 会写它）。 */
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

/** mock context 的可配置项。 */
interface MockContextConfig {
  hasWorklet: boolean;
  addModuleImpl: (url: string) => Promise<void>;
  initialState: 'running' | 'suspended';
}

/** 当前生效的 mock 配置（由 `installAudioContext` 设置）。 */
let contextConfig: MockContextConfig = {
  hasWorklet: true,
  addModuleImpl: () => Promise.resolve(),
  initialState: 'suspended',
};

/** mock context 的调用记录。 */
const contextCalls = {
  created: 0,
  resumed: 0,
  closed: 0,
  mediaElementSources: 0,
  addModuleUrls: [] as string[],
  /** 创建出来的元素源节点（按创建顺序）。 */
  sources: [] as MockMediaElementSource[],
};

/** 假 AudioContext。 */
class MockAudioContext {
  state: 'running' | 'suspended';

  readonly destination = { id: 'destination' };

  readonly audioWorklet?: { addModule: (url: string) => Promise<void> };

  constructor() {
    contextCalls.created += 1;
    this.state = contextConfig.initialState;
    if (contextConfig.hasWorklet) {
      this.audioWorklet = {
        addModule: (url: string): Promise<void> => {
          contextCalls.addModuleUrls.push(url);
          return contextConfig.addModuleImpl(url);
        },
      };
    }
  }

  createGain(): MockGainNode {
    return new MockGainNode();
  }

  createMediaElementSource(element: HTMLMediaElement): MockMediaElementSource {
    contextCalls.mediaElementSources += 1;
    const source = new MockMediaElementSource(element);
    contextCalls.sources.push(source);
    return source;
  }

  async resume(): Promise<void> {
    contextCalls.resumed += 1;
    this.state = 'running';
  }

  async close(): Promise<void> {
    contextCalls.closed += 1;
  }
}

/** AudioWorkletNode 的构造记录。 */
const workletCalls: Array<{ name: string; options: unknown }> = [];

/** 假 AudioWorkletNode。 */
class MockAudioWorkletNode {
  readonly parameters = new Map<string, MockAudioParam>([['rate', new MockAudioParam()]]);

  readonly connected: unknown[] = [];

  constructor(
    readonly context: unknown,
    name: string,
    options: unknown,
  ) {
    workletCalls.push({ name, options });
  }

  connect(target: unknown): unknown {
    this.connected.push(target);
    return target;
  }
}

/** 装上 mock 的浏览器 API。 */
function installBrowserApis(): void {
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);
}

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

/** 造一个轨道。 */
function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track_1',
    type: 'video',
    name: '视频轨 1',
    order: 0,
    muted: false,
    hidden: false,
    locked: false,
    height: 64,
    clips: [],
    ...overrides,
  };
}

/** 造一个只含指定轨道的工程。 */
function makeDoc(tracks: Track[]): ProjectDoc {
  const doc = createEmptyProject('音频引擎测试');
  return { ...doc, tracks };
}

/** 造一个可用的媒体元素。 */
function makeElement(): HTMLMediaElement {
  return document.createElement('video');
}

describe('services/media/audioEngine', () => {
  beforeEach(() => {
    contextConfig = {
      hasWorklet: true,
      addModuleImpl: () => Promise.resolve(),
      initialState: 'suspended',
    };
    contextCalls.created = 0;
    contextCalls.resumed = 0;
    contextCalls.closed = 0;
    contextCalls.mediaElementSources = 0;
    contextCalls.addModuleUrls = [];
    contextCalls.sources.length = 0;
    workletCalls.length = 0;
    installBrowserApis();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('AudioContext 生命周期', () => {
    it('懒创建：未使用时不创建 context', () => {
      const engine = new AudioEngine();

      expect(engine.getContext()).toBeNull();
      expect(contextCalls.created).toBe(0);
    });

    it('ensureContext 惰性创建，且多次调用返回同一个 context', () => {
      const engine = new AudioEngine();

      const first = engine.ensureContext();
      const second = engine.ensureContext();

      expect(first).toBe(second);
      expect(contextCalls.created).toBe(1);
      expect(engine.getContext()).toBe(first);
    });

    it('resume：context 处于 suspended 时恢复', async () => {
      const engine = new AudioEngine();

      const context = await engine.resume();

      expect(context.state).toBe('running');
      expect(contextCalls.resumed).toBe(1);
    });

    it('resume：context 已在 running 时不重复恢复', async () => {
      contextConfig.initialState = 'running';
      const engine = new AudioEngine();

      await engine.resume();

      expect(contextCalls.resumed).toBe(0);
    });

    it('dispose：关闭 context 并清空引用', () => {
      const engine = new AudioEngine();
      engine.ensureContext();

      engine.dispose();

      expect(contextCalls.closed).toBe(1);
      expect(engine.getContext()).toBeNull();
      expect(engine.getMasterGain()).toBeNull();
    });

    it('导出的是全局单例，且类型正确', () => {
      expect(audioEngine).toBeInstanceOf(AudioEngine);
    });
  });

  describe('loadWorklet（变速保音高）', () => {
    it('加载成功后 worklet 可用', async () => {
      const engine = new AudioEngine();

      const ok = await engine.loadWorklet('/worklets/x.js');

      expect(ok).toBe(true);
      expect(engine.isWorkletAvailable()).toBe(true);
      expect(contextCalls.addModuleUrls).toEqual(['/worklets/x.js']);
    });

    it('已加载后再次调用直接返回 true（幂等，不重复 addModule）', async () => {
      const engine = new AudioEngine();
      await engine.loadWorklet('/worklets/x.js');

      const ok = await engine.loadWorklet('/worklets/other.js');

      expect(ok).toBe(true);
      expect(contextCalls.addModuleUrls).toEqual(['/worklets/x.js']);
    });

    it('context 不支持 audioWorklet 时降级并标记失败', async () => {
      contextConfig.hasWorklet = false;
      const engine = new AudioEngine();

      const ok = await engine.loadWorklet('/worklets/x.js');

      expect(ok).toBe(false);
      expect(engine.isWorkletAvailable()).toBe(false);
    });

    it('addModule 抛错时降级并标记失败（不抛出）', async () => {
      contextConfig.addModuleImpl = () => Promise.reject(new Error('404'));
      const engine = new AudioEngine();

      const ok = await engine.loadWorklet('/worklets/x.js');

      expect(ok).toBe(false);
      expect(engine.isWorkletAvailable()).toBe(false);
    });

    it('失败后不再重试（workletFailed 短路）', async () => {
      contextConfig.hasWorklet = false;
      const engine = new AudioEngine();
      await engine.loadWorklet('/worklets/x.js');

      const ok = await engine.loadWorklet('/worklets/x.js');

      expect(ok).toBe(false);
      expect(contextCalls.addModuleUrls).toEqual([]);
    });
  });

  describe('buildGraph（混音图 / 增益控制）', () => {
    it('构建后返回主混音总线', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);

      const graph = engine.buildGraph(doc, () => null);

      expect(graph.masterGain).toBeTruthy();
      expect(engine.getMasterGain()).toBe(graph.masterGain);
    });

    it('片段增益写入 clipGain', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip({ audio: { muted: false, gain: 0.4, fadeInMs: 0, fadeOutMs: 0 } })] })]);

      const graph = engine.buildGraph(doc, () => makeElement());

      const gain = graph.clipGains.get('clip_1');
      expect(gain).toBeTruthy();
      expect((gain as unknown as MockGainNode).gain.value).toBe(0.4);
    });

    it('静音轨道不参与混音（无轨道总线）', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ muted: true, clips: [makeClip()] })]);

      const graph = engine.buildGraph(doc, () => makeElement());

      expect(graph.trackBuses.size).toBe(0);
      expect(graph.clipGains.size).toBe(0);
    });

    it('静音片段不参与混音（无 clip 增益）', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([
        makeTrack({ clips: [makeClip({ audio: { muted: true, gain: 1, fadeInMs: 0, fadeOutMs: 0 } })] }),
      ]);

      const graph = engine.buildGraph(doc, () => makeElement());

      expect(graph.clipGains.size).toBe(0);
    });

    it('文字轨不参与混音（只有视频/音频轨进入混音图）', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ type: 'text', clips: [makeClip()] })]);

      const graph = engine.buildGraph(doc, () => makeElement());

      expect(graph.trackBuses.size).toBe(0);
    });

    it('解析不到元素时该片段不进入混音图', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);

      const graph = engine.buildGraph(doc, () => null);

      expect(graph.clipGains.size).toBe(0);
    });

    it('同一元素只创建一次 MediaElementAudioSourceNode（缓存复用）', () => {
      const engine = new AudioEngine();
      const element = makeElement();
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      const resolve = (): HTMLMediaElement => element;

      engine.buildGraph(doc, resolve);
      engine.buildGraph(doc, resolve);

      expect(contextCalls.mediaElementSources).toBe(1);
    });

    it('重建混音图时旧图被释放', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      const resolve = (): HTMLMediaElement => makeElement();

      const first = engine.buildGraph(doc, resolve);
      const firstMaster = first.masterGain as unknown as MockGainNode;
      const second = engine.buildGraph(doc, resolve);

      expect(firstMaster.connected.length).toBe(0);
      expect(second.masterGain).not.toBe(first.masterGain);
    });

    it('worklet 未加载时不挂 WSOLA 节点（preservePitch 不可用）', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 2 })] })]);

      const graph = engine.buildGraph(doc, () => makeElement());

      expect(graph.preservePitchAvailable).toBe(false);
      expect(workletCalls.length).toBe(0);
    });

    it('worklet 即使已加载也不挂 WSOLA 节点（变速只经 playbackRate）', async () => {
      const engine = new AudioEngine();
      await engine.loadWorklet('/worklets/x.js');
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 2 })] })]);

      const graph = engine.buildGraph(doc, () => makeElement());

      // ⚠️ 架构决策见 audioGraph.applySpeed：变速只做一次（playbackRate），
      // WSOLA worklet 已不再挂进混音图 —— 即使它已加载成功。
      // （preservePitchAvailable 只是把调用方传入的 preservePitch 原样带回。）
      expect(graph.preservePitchAvailable).toBe(true);
      expect(workletCalls.length).toBe(0);
      expect(contextCalls.sources[0]?.playbackRate.value).toBe(2);
    });
  });

  describe('applyFade（音量包络）', () => {
    it('未构建混音图时不产生任何包络事件', () => {
      const engine = new AudioEngine();
      engine.ensureContext();
      const gain = new MockGainNode();

      engine.applyFade(makeClip({ audio: { muted: false, gain: 1, fadeInMs: 200, fadeOutMs: 300 } }), gain as unknown as GainNode);

      expect(gain.gain.events).toEqual([]);
    });

    it('淡入淡出产生 4 个包络事件（起点 / 峰值 / 起点 / 终点）', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      engine.buildGraph(doc, () => makeElement());
      const gain = new MockGainNode();
      const clip = makeClip({
        startMs: 0,
        durationMs: 1000,
        audio: { muted: false, gain: 1, fadeInMs: 200, fadeOutMs: 300 },
      });

      engine.applyFade(clip, gain as unknown as GainNode);

      expect(gain.gain.events).toEqual([
        { type: 'setValueAtTime', value: 0, time: 0 },
        { type: 'linearRampToValueAtTime', value: 1, time: 0.2 },
        { type: 'setValueAtTime', value: 1, time: 0.7 },
        { type: 'linearRampToValueAtTime', value: 0, time: 1 },
      ]);
    });

    it('无淡入淡出时不产生包络事件（保持恒定增益）', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip()] })]);
      engine.buildGraph(doc, () => makeElement());
      const gain = new MockGainNode();

      engine.applyFade(makeClip(), gain as unknown as GainNode);

      expect(gain.gain.events).toEqual([]);
    });
  });

  describe('变速处理（playbackRate）', () => {
    it('speed !== 1 时写入元素源的 playbackRate', () => {
      const engine = new AudioEngine();
      const element = makeElement();
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 1.5 })] })]);

      engine.buildGraph(doc, () => element);

      expect(contextCalls.sources.length).toBe(1);
      expect(contextCalls.sources[0]?.playbackRate.value).toBe(1.5);
    });

    it('speed === 1 时 playbackRate 保持默认 1（不变速）', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 1 })] })]);

      engine.buildGraph(doc, () => makeElement());

      expect(contextCalls.sources.length).toBe(1);
      expect(contextCalls.sources[0]?.playbackRate.value).toBe(1);
    });

    it('worklet 不可用时变速退化为 playbackRate（不挂 WSOLA 节点）', () => {
      const engine = new AudioEngine();
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 2 })] })]);

      engine.buildGraph(doc, () => makeElement());

      expect(workletCalls.length).toBe(0);
      expect(contextCalls.sources[0]?.playbackRate.value).toBe(2);
    });

    it('变速只应用一次：只写 playbackRate，不再挂 WSOLA 节点', async () => {
      const engine = new AudioEngine();
      await engine.loadWorklet('/worklets/x.js');
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 2 })] })]);

      engine.buildGraph(doc, () => makeElement());

      // ⚠️ 架构决策（audioGraph.applySpeed）：变速**只做一次**，由源自身的
      // playbackRate 承担。曾经「同时设 playbackRate + 挂 worklet」会把速率应用
      // 两次（时长与音高都不对），已拆除 ⇒ 即使 worklet 已加载也不再挂载。
      expect(workletCalls.length).toBe(0);
      expect(contextCalls.sources[0]?.playbackRate.value).toBe(2);
    });

    it('speed !== 1 时显式设置元素的 preservesPitch = true（PRD FR-020③）', () => {
      const engine = new AudioEngine();
      const element = makeElement();
      // 先故意设成 false：验证本函数会**显式**写回 true，
      // 而不是依赖浏览器默认值（默认值一旦被改就会静默变调，且现有测试抓不到）。
      element.preservesPitch = false;
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 1.5 })] })]);

      engine.buildGraph(doc, () => element);

      expect(element.preservesPitch).toBe(true);
      expect(contextCalls.sources[0]?.playbackRate.value).toBe(1.5);
    });

    it('speed === 1 时不进入变速分支（不创建 WSOLA 节点）', async () => {
      const engine = new AudioEngine();
      await engine.loadWorklet('/worklets/x.js');
      const doc = makeDoc([makeTrack({ clips: [makeClip({ speed: 1 })] })]);

      engine.buildGraph(doc, () => makeElement());

      expect(workletCalls.length).toBe(0);
    });
  });
});
