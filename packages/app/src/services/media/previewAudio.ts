/**
 * 预览音频接线（**「没有声音」的修复点**）。
 *
 * ## 现状与根因
 *
 * `audioEngine.ts` / `audioGraph.ts` 的混音逻辑早已实现完整，但**零调用方** ——
 * 预览侧根本没有 WebAudio 图，于是用户导入视频、点播放，看到的只有画面。
 *
 * 本模块负责**接线**（不是重写混音）：
 *
 * ```
 * <video>/<audio> 元素
 *   └─ MediaElementAudioSourceNode   （元素音频从此只能经此节点输出）
 *        └─ [WSOLA worklet]           （clip.speed !== 1 时）
 *             └─ clipGain             （clip.audio.gain × 淡入淡出包络）
 *                  └─ trackBus        （track.muted / 音频轨 hidden 为真则不建）
 *                       └─ masterGain （settings.masterGain，默认 1）
 *                            └─ AudioContext.destination
 * ```
 *
 * ## 为什么包络是「每帧算」而不是「一次性排程」
 *
 * `audioGraph.applyFadeEnvelope` 用 `setValueAtTime(t, clip.startMs/1000)` 把包络
 * 挂在 **AudioContext 时间轴**上 —— 这对 `OfflineAudioContext`（导出侧，
 * context 时间 == 时间线时间）是正确的，但对预览是错的：
 *
 * - 预览的 AudioContext 在**用户第一次点播放**时才 `resume()`，它的时间轴起点与
 *   时间线的 0 毫无关系；
 * - 一旦 seek，之前排的包络全部落在错误位置。
 *
 * 因此预览侧改用 {@link fadeGainAt} —— **纯函数**，按当前播放头位置直接算出
 * 增益倍率并写入 `clipGain.gain.value`。代价是包络精度到帧级（60Hz），
 * 对预览完全够用；导出侧仍走 `applyFadeEnvelope` 的采样级排程。
 *
 * ## 分层
 *
 * 纯服务层：只依赖注入的 `resolveElement` / `unmuteElement` / `engine`，
 * **不感知 React、不 import 任何 store**，因此可以完全用假元素做单元测试。
 */

import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';
import { AudioEngine } from './audioEngine.js';
import { buildAudioGraph, type AudioGraph } from './audioGraph.js';

/** 默认主音量（`doc.settings.masterGain` 缺省时）。 */
export const DEFAULT_MASTER_GAIN = 1;

/** 主音量允许的最大值（防止误填超大值把总线打爆）。 */
export const MAX_MASTER_GAIN = 2;

/** 增益写入死区：变化小于该值就不写 `AudioParam`，避免每帧无谓的自动化事件。 */
const GAIN_EPSILON = 1e-4;

/**
 * 计算某 clip 在 `timeMs` 处的淡入淡出增益倍率（0~1）。
 *
 * - 播放头在 clip 区间之外 → `0`（顺带实现「非活动 clip 静音」）；
 * - 无淡入淡出且在区间内 → `1`。
 *
 * 纯函数：不碰 DOM / AudioContext，可直接单测。
 */
export function fadeGainAt(clip: Clip, timeMs: number): number {
  const local = timeMs - clip.startMs;
  if (local < 0 || local > clip.durationMs) return 0;

  const { fadeInMs, fadeOutMs } = clip.audio;
  if (fadeInMs <= 0 && fadeOutMs <= 0) return 1;

  let multiplier = 1;

  // 淡入：0 → 1（fadeInMs 不得长于 clip 本身，否则永远升不到 1）
  if (fadeInMs > 0) {
    const span = Math.min(fadeInMs, clip.durationMs);
    multiplier *= Math.min(1, local / span);
  }

  // 淡出：1 → 0
  if (fadeOutMs > 0) {
    const span = Math.min(fadeOutMs, clip.durationMs);
    const remaining = clip.durationMs - local;
    multiplier *= Math.min(1, remaining / span);
  }

  return Math.max(0, Math.min(1, multiplier));
}

/**
 * 解析工程主音量。
 *
 * `ProjectSettings` 当前**没有**主音量字段（已核对 `shared-types/src/project.ts`），
 * 这里按 `settings.masterGain` 读取一个**可选**数值并夹紧到 `[0, 2]`，
 * 缺省或非法时返回 {@link DEFAULT_MASTER_GAIN}。
 *
 * 之所以不立刻往 schema 加必填字段：工程 JSON 是用户数据，加必填项会触发迁移；
 * 而 `ProjectSettings` 已有 `[extra: string]: unknown`，先按可选读取、UI 后补，
 * 既不留「读不到」的死代码，也不破坏既有工程文件。
 */
export function resolveMasterGain(doc: ProjectDoc): number {
  const raw = (doc.settings as { masterGain?: unknown }).masterGain;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MASTER_GAIN;
  return Math.max(0, Math.min(MAX_MASTER_GAIN, raw));
}

/** 预览音频诊断快照（供 e2e / 设置面板展示断言）。 */
export interface PreviewAudioDiagnostics {
  /**
   * AudioContext 状态；未创建时为 `null`。
   *
   * 直接用 DOM  lib 的 `AudioContextState`：它在较新的 TS lib 里还包含
   * `'interrupted'`（Safari 专有），在这里收窄反而会在新 TS 上编译失败。
   */
  contextState: AudioContextState | null;
  /** 主混音总线当前增益（未建图时为 0）。 */
  masterGain: number;
  /** 进入混音图的轨道总线数量。 */
  trackBusCount: number;
  /** 进入混音图的片段数量。 */
  clipCount: number;
  /** 已建立 `MediaElementAudioSourceNode` 的**不同元素**数量。 */
  routedElementCount: number;
  /** 已被解除 `muted` 的元素数量（接入 WebAudio 后元素不再静音）。 */
  unmutedElementCount: number;
  /** 变速保音高 worklet 是否可用。 */
  workletAvailable: boolean;
}

/** 预览音频控制器。 */
export interface PreviewAudioController {
  /** 底层引擎（暴露给设置面板 / 测试）。 */
  readonly engine: AudioEngine;
  /**
   * 用户手势内调用：懒创建 + 恢复 AudioContext。
   *
   * 浏览器自动播放策略要求这一步发生在手势调用栈内；异步延后会失败 ——
   * 这正是「点了播放还是没声音」最常见的原因。
   */
  unlock: () => Promise<void>;
  /** 工程变化时重建混音图。 */
  sync: (doc: ProjectDoc) => void;
  /** 播放 / 暂停。 */
  setPlaying: (playing: boolean) => void;
  /** 播放头位置变化（逐帧 + seek）。 */
  setPosition: (timeMs: number) => void;
  /**
   * 读取某 clip 的增益节点。
   *
   * 供设置面板展示 / e2e 断言「这个 clip 现在到底有多响」——
   * `gain.gain.value` 是**唯一**能客观回答「真的有声音吗」的信号之一。
   * clip 不在混音图内（静音轨道 / 未就绪）时返回 `null`。
   */
  getClipGainNode: (clipId: string) => GainNode | null;
  /** 便捷读取某 clip 当前生效的增益数值（= {@link getClipGainNode} 的 `.gain.value`）。 */
  getClipGain: (clipId: string) => number | null;
  /**
   * 主混音总线节点（未建图 / 已释放时为 `null`）。
   *
   * ⚠️ **不要**用 `AudioEngine.getMasterGain()` 取本模块的图：那个方法返回的是
   * `engine.buildGraph()` 建的图，而预览走的是本模块自己建的图，两者不是同一个。
   */
  getMasterGainNode: () => GainNode | null;
  /** 诊断快照。 */
  getDiagnostics: () => PreviewAudioDiagnostics;
  /** 释放（重复调用安全）。 */
  dispose: () => void;
}

/** 预览音频控制器创建参数。 */
export interface PreviewAudioOptions {
  /** 依据 clip 找到媒体元素（<video> / <audio>）；未就绪返回 null。 */
  resolveElement: (clip: Clip, track: Track) => HTMLMediaElement | null;
  /**
   * 解除某素材元素的 `muted`（接入 WebAudio 后必须调用）。
   *
   * ⚠️ 这一步是「接上 WebAudio 后必须有声音」的**关键**：
   * `HTMLMediaElement.muted` 是元素输出的闸门，`muted = true` 会连
   * `MediaElementAudioSourceNode` 的输出一起掐掉。
   *
   * 只对**已经拿到 source node 的素材**调用 —— 未接管的元素保持静音，
   * 否则它们会绕过混音图直连扬声器、互相叠加。
   */
  unmuteAsset: (assetId: string) => void;
  /** 注入引擎（测试 / 多实例用）。 */
  engine?: AudioEngine;
}

/**
 * 当前生效的预览音频控制器（由 `PreviewCanvas` 登记）。
 *
 * ## 为什么需要这个模块级单例
 *
 * 浏览器自动播放策略要求 `AudioContext.resume()` 发生在**用户手势调用栈内**。
 * 播放按钮（`PreviewControls` / `TopToolbar`）因此必须在 `onClick` 里同步解锁 ——
 * 而控制器是由 `PreviewCanvas` 内部创建的。
 *
 * 两条备选：
 * - 层层透传 props：`AppLayout → PreviewPanel → PreviewControls`，污染 3 个组件；
 * - 快捷键播放：`useHotkeys` 在全局监听里，更拿不到 props。
 *
 * 登记成模块级引用是这里最轻的做法，语义上也准确 —— **同一时刻只有一个预览**。
 */
let activePreviewAudio: PreviewAudioController | null = null;

/** 登记当前预览音频控制器（传 `null` 表示取消登记）。 */
export function setActivePreviewAudio(controller: PreviewAudioController | null): void {
  activePreviewAudio = controller;
}

/** 取得当前预览音频控制器（未挂载预览时为 `null`）。 */
export function getActivePreviewAudio(): PreviewAudioController | null {
  return activePreviewAudio;
}

/**
 * 在用户手势内解锁 AudioContext。
 *
 * 播放按钮的 `onClick` 直接调它 —— 这是「点了播放有声音」的关键一步。
 * 未挂载预览 / 已释放时静默返回（不影响画面播放）。
 */
export function unlockPreviewAudio(): Promise<void> {
  return activePreviewAudio ? activePreviewAudio.unlock() : Promise.resolve();
}

/** 预览音频诊断快照（e2e / 设置面板用；未挂载预览时各项为 0 / null）。 */
export function getPreviewAudioDiagnostics(): PreviewAudioDiagnostics {
  return (
    activePreviewAudio?.getDiagnostics() ?? {
      contextState: null,
      masterGain: 0,
      trackBusCount: 0,
      clipCount: 0,
      routedElementCount: 0,
      unmutedElementCount: 0,
      workletAvailable: false,
    }
  );
}

/** clip 及其所属轨道（建图后按 clipId 查表，避免 seek 时 O(n²) 扫描）。 */
interface ClipBinding {
  clip: Clip;
  track: Track;
}

/**
 * 创建预览音频控制器。
 */
export function createPreviewAudio(options: PreviewAudioOptions): PreviewAudioController {
  const engine = options.engine ?? new AudioEngine();
  const { resolveElement, unmuteAsset } = options;

  let graph: AudioGraph | null = null;
  let doc: ProjectDoc | null = null;
  let currentTimeMs = 0;
  /** clipId → { clip, track }。 */
  let bindings = new Map<string, ClipBinding>();
  /** 已解除 muted 的素材 id（诊断计数 + 幂等）。 */
  const unmutedAssetIds = new Set<string>();
  /** 已建立 source node 的元素（诊断计数）。 */
  const routedElements = new Set<HTMLMediaElement>();
  let disposed = false;

  /** 逐帧把 `clip.audio.gain × 淡入淡出包络` 写进对应的 `clipGain`。 */
  const applyGains = (): void => {
    if (!graph) return;
    const context = engine.getContext();
    for (const [clipId, clipGain] of graph.clipGains) {
      const clip = bindings.get(clipId)?.clip;
      if (!clip) continue;
      const target = clip.audio.gain * fadeGainAt(clip, currentTimeMs);
      const param = clipGain.gain;
      if (Math.abs(param.value - target) <= GAIN_EPSILON) continue;
      // cancelAndHoldAtTime：保住 seek 瞬间的当前值，避免参数跳变发出「咔」声。
      // 老浏览器没有该方法时退回 cancelScheduledValues。
      if (typeof param.cancelAndHoldAtTime === 'function' && context) {
        param.cancelAndHoldAtTime(context.currentTime);
      } else if (typeof param.cancelScheduledValues === 'function') {
        param.cancelScheduledValues(0);
      }
      param.value = target;
    }
  };

  const sync = (nextDoc: ProjectDoc): void => {
    if (disposed) return;
    doc = nextDoc;

    const nextBindings = new Map<string, ClipBinding>();
    for (const track of nextDoc.tracks) {
      for (const clip of track.clips) {
        nextBindings.set(clip.id, { clip, track });
      }
    }
    bindings = nextBindings;

    let nextGraph: AudioGraph;
    try {
      nextGraph = buildAudioGraph(engine.ensureContext(), nextDoc, {
        preservePitch: engine.isWorkletAvailable(),
        ...(engine.isWorkletAvailable() ? { workletModuleUrl: engine.workletModuleUrl } : {}),
        resolveSource: (clip, track) => {
          const element = resolveElement(clip, track);
          if (!element) return null;
          routedElements.add(element);
          // 走 AudioEngine 的缓存：同一元素只 create 一次 source node。
          return engine.attachElement(element);
        },
      });
    } catch {
      // 建图失败（浏览器不支持 WebAudio / 元素状态异常）：退回「纯画面预览」。
      graph?.dispose();
      graph = null;
      return;
    }

    // 旧图在新图就位后再释放：buildAudioGraph 不接管旧图的生命周期，
    // 直接先断会让同一瞬间出现输出空洞。
    graph?.dispose();
    graph = nextGraph;
    graph.masterGain.gain.value = resolveMasterGain(nextDoc);

    // 关键：只有**已进入混音图**的 clip 才解除其元素的静音。
    // 未接管的元素（静音轨道、纯图片、尚未就绪）保持 muted，避免各自直连扬声器。
    unmutedAssetIds.clear();
    for (const clipId of graph.clipGains.keys()) {
      const binding = bindings.get(clipId);
      if (!binding || binding.clip.assetId === null) continue;
      // 必须真的能取到元素才算「已接管」：元素未就绪时 source node 是哑的，
      // 此时解除静音只会让元素绕过混音图直连扬声器。
      if (!resolveElement(binding.clip, binding.track)) continue;
      unmuteAsset(binding.clip.assetId);
      unmutedAssetIds.add(binding.clip.assetId);
    }

    applyGains();
  };

  const setPosition = (timeMs: number): void => {
    if (disposed) return;
    currentTimeMs = timeMs;
    applyGains();
  };

  const setPlaying = (playing: boolean): void => {
    if (disposed) return;
    if (playing) {
      applyGains();
      return;
    }
    // 暂停即静音：把包络倍率归零，避免暂停时残留的自动化尾巴。
    for (const clipGain of graph?.clipGains.values() ?? []) {
      clipGain.gain.value = 0;
    }
  };

  const unlock = async (): Promise<void> => {
    if (disposed) return;
    try {
      await engine.resume();
    } catch {
      // 自动播放策略拒绝：保持现状（画面照常播），下次手势再试。
    }
    if (!graph && doc) sync(doc);
    // worklet 加载是异步的；成功后重建图，让变速片段走保音高通路。
    void engine
      .loadWorklet(engine.workletModuleUrl)
      .then((ok) => {
        if (ok && doc && !disposed) sync(doc);
      })
      .catch(() => {
        // loadWorklet 内部已降级；这里只防止 unhandled rejection。
      });
  };

  const getClipGainNode = (clipId: string): GainNode | null => {
    return graph?.clipGains.get(clipId) ?? null;
  };

  const getClipGain = (clipId: string): number | null => {
    return getClipGainNode(clipId)?.gain.value ?? null;
  };

  const getMasterGainNode = (): GainNode | null => {
    return graph?.masterGain ?? null;
  };

  const getDiagnostics = (): PreviewAudioDiagnostics => {
    const context = engine.getContext();
    return {
      contextState: context?.state ?? null,
      masterGain: graph?.masterGain.gain.value ?? 0,
      trackBusCount: graph?.trackBuses.size ?? 0,
      clipCount: graph?.clipGains.size ?? 0,
      routedElementCount: routedElements.size,
      unmutedElementCount: unmutedAssetIds.size,
      workletAvailable: engine.isWorkletAvailable(),
    };
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    graph?.dispose();
    graph = null;
    doc = null;
    bindings = new Map();
    unmutedAssetIds.clear();
    routedElements.clear();
    engine.dispose();
  };

  return {
    engine,
    unlock,
    sync,
    setPlaying,
    setPosition,
    getClipGainNode,
    getClipGain,
    getMasterGainNode,
    getDiagnostics,
    dispose,
  };
}