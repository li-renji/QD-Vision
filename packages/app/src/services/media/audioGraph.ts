/**
 * 混音总线拓扑（**预览与导出共用同一份代码**，FR-035）。
 *
 * 拓扑：
 * ```
 * clip source → clipGain(gain) → [淡入淡出包络] → trackBus → masterGain → destination
 * ```
 *
 * 预览侧构建到 `AudioContext`，导出侧构建到 `OfflineAudioContext`，
 * **只有 context 类型不同**，拓扑与增益计算完全一致 —— 这是「所见即所得」的落地方式。
 *
 * ## 变速在哪一层（重要）
 *
 * 变速**不在本图里**，而由**音频源自身**的 `playbackRate` 承担（唯一一处）：
 * - 预览侧：`<video>` / `<audio>` 元素 —— 见 {@link applySpeed} 的说明；
 * - 导出侧：`AudioBufferSourceNode` —— 见 `services/export/offlineAudioRenderer.ts`。
 *
 * 本图只负责增益、静音、淡入淡出。历史上曾在本图里额外挂 WSOLA worklet 做变速，
 * 导致速率被应用两次（时长与音高都不对），已拆除，见 {@link applySpeed}。
 */

import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';

/**
 * 变速保音高 worklet 的模块名。
 *
 * ⚠️ **已停用**：WSOLA worklet 不再挂进混音图（见 {@link applySpeed} 的架构决策）。
 * 这里保留常量仅为兼容既有 import；运行时文件
 * `packages/app/public/worklets/pitchPreserveStretchProcessor.js` 也一并停用。
 */
export const PITCH_PRESERVE_WORKLET_NAME = 'clipcut-pitch-preserve-stretch';

/** 混音图构建参数。 */
export interface AudioGraphOptions {
  /** 为某个 clip 取得音频源（返回 null 表示该 clip 无音频）。 */
  resolveSource: (clip: Clip, track: Track) => AudioNode | null;
  /**
   * 变速时是否保持音高。
   *
   * ⚠️ **已停用，无任何作用**（保留字段仅为兼容既有调用方）。
   * 保音高现在由音频源自身决定：预览侧用元素的 `preservesPitch`（PRD FR-020③），
   * 导出侧的 `AudioBufferSourceNode` 没有该属性 ⇒ 音高随变速变化。
   */
  preservePitch?: boolean;
  /**
   * worklet 模块 URL。
   *
   * ⚠️ **已停用，无任何作用**（保留字段仅为兼容既有调用方）。
   */
  workletModuleUrl?: string;
  /**
   * 复用外部已建好的主总线（可选）。
   *
   * ## 为什么需要
   *
   * 混音图会在**每次工程变化时重建**（增删 clip、改增益、切轨道静音）。
   * 若主总线也跟着重建：
   * ① 挂在它下游的观测节点（AnalyserNode / 表头电平表）会**被孤立** ——
   *    节点身份变了，旧节点虽还在，但已 `disconnect()`；
   * ② 用户每改一次参数，主总线重新 `connect(destination)` 会产生一次
   *    可听的「咔」声。
   *
   * 因此预览侧把主总线提升为**长生命周期节点**，只重建轨道总线与片段增益。
   * 传入本选项时，`dispose()` **不会**断开它 —— 生命周期归调用方所有。
   */
  masterGain?: GainNode;
}

/** 构建好的混音图。 */
export interface AudioGraph {
  /** 主混音总线 */
  masterGain: GainNode;
  /** 轨道总线：trackId → GainNode */
  trackBuses: Map<string, GainNode>;
  /** clip 增益节点：clipId → GainNode */
  clipGains: Map<string, GainNode>;
  /**
   * 变速保音高是否可用。
   *
   * ⚠️ **已停用，恒为调用方传入的 `preservePitch`**，不再反映 worklet 的真实状态
   * （worklet 已不挂载）。保音高由音频源自身的 `preservesPitch` 决定。
   */
  preservePitchAvailable: boolean;
  /** 释放所有节点。 */
  dispose: () => void;
}

/**
 * 参与混音的轨道（音频轨 + 视频轨）。
 *
 * 只做**类型**筛选；是否真的发声由 {@link isTrackAudible} 判断。
 */
export function mixableTracks(doc: ProjectDoc): Track[] {
  return doc.tracks.filter((track) => track.type === 'audio' || track.type === 'video');
}

/**
 * 轨道是否发声。
 *
 * - `muted`：轨道头的「静音」按钮 —— 视频轨与音频轨都静音。
 * - `hidden`：轨道头的「隐藏」按钮。**只对音频轨生效** ——
 *   音频轨没有画面，「隐藏」是它唯一的停用开关；而视频轨的 `hidden`
 *   按 NLE 惯例只影响画面（画布上不画），声音照常播放。
 *
 * 把这两条收在一处，预览与导出因此看到同一份判断。
 */
export function isTrackAudible(track: Track): boolean {
  if (track.muted) return false;
  if (track.hidden && track.type === 'audio') return false;
  return true;
}

/**
 * 构建混音图。
 */
export function buildAudioGraph(
  context: BaseAudioContext,
  doc: ProjectDoc,
  options: AudioGraphOptions,
): AudioGraph {
  // 主总线可以是外部提供的长生命周期节点（见 AudioGraphOptions.masterGain）。
  // 复用时**不能**再 connect 到 destination —— 那会造成重复连接与爆音。
  const masterGain = options.masterGain ?? context.createGain();
  const ownsMasterGain = options.masterGain === undefined;
  if (ownsMasterGain) {
    masterGain.gain.value = 1;
    masterGain.connect(context.destination);
  }

  const trackBuses = new Map<string, GainNode>();
  const clipGains = new Map<string, GainNode>();
  const preservePitch = options.preservePitch !== false;

  for (const track of mixableTracks(doc)) {
    if (!isTrackAudible(track)) continue;

    const bus = context.createGain();
    bus.gain.value = 1;
    bus.connect(masterGain);
    trackBuses.set(track.id, bus);
  }

  for (const track of mixableTracks(doc)) {
    const bus = trackBuses.get(track.id);
    if (!bus) continue;

    for (const clip of track.clips) {
      if (clip.audio.muted) continue;

      const source = options.resolveSource(clip, track);
      if (!source) continue;

      const clipGain = context.createGain();
      clipGain.gain.value = clip.audio.gain;
      clipGains.set(clip.id, clipGain);

      let node: AudioNode = source;
      if (clip.speed !== 1) {
        node = applySpeed(context, node, clip.speed, preservePitch, options.workletModuleUrl);
      }

      node.connect(clipGain);
      clipGain.connect(bus);
    }
  }

  return {
    masterGain,
    trackBuses,
    clipGains,
    preservePitchAvailable: preservePitch,
    dispose: () => {
      for (const gain of clipGains.values()) {
        try {
          gain.disconnect();
        } catch {
          // 已断开
        }
      }
      for (const bus of trackBuses.values()) {
        try {
          bus.disconnect();
        } catch {
          // 已断开
        }
      }
      // 外部提供的主总线归调用方所有 —— 不能在这里断开，
      // 否则挂在它下游的观测节点（AnalyserNode 等）会被一并孤立。
      if (ownsMasterGain) {
        try {
          masterGain.disconnect();
        } catch {
          // 已断开
        }
      }
      clipGains.clear();
      trackBuses.clear();
    },
  };
}

/**
 * 应用变速（**唯一一处**）。
 *
 * ## 架构决策（2026-10-23 实测后定稿，勿回退）
 *
 * 变速只做一次：**由源自身的 `playbackRate` 承担**。
 * - 预览：`<video>` / `<audio>` 元素 ⇒ `element.playbackRate = clip.speed`
 *   （再由元素的 `preservesPitch = true` 决定是否保音高，见 PRD FR-020③）；
 * - 导出：`AudioBufferSourceNode.playbackRate = clip.speed`
 *   （见 `services/export/offlineAudioRenderer.ts`，该节点没有 `preservesPitch`）。
 *
 * ⚠️ 曾经的错误做法：**同时**设 `playbackRate` 和挂 WSOLA worklet
 * （`processorOptions: { rate: speed }`）⇒ 速率被应用两次，输出时长与音高都不对。
 *
 * ⚠️ 为什么不再用 WSOLA worklet 做变速（三条实测结论，别重新踩）：
 * 1. WSOLA 是「时间伸缩」（改时长、**保**音高），它**不能把音高还原** ——
 *    想「用 playbackRate 变速 + worklet 补偿音高」需要的是 pitch shifter
 *    （PSOLA / 相位声码器），是另一个算法，不是加个参数。
 * 2. **有界缓冲的流式处理器做不了时间伸缩**：减速时「已到达但未消费」的素材
 *    积压无界增长（固定缓冲必然被冲掉）；加速则需要尚未到达的素材。
 *    Node 逐量子实测（3 秒脉冲素材、rate=0.5）：HISTORY=4096 → 垃圾；
 *    HISTORY=65536 → 正确（间隔 0.9987s），但更长的素材仍会崩。
 * 3. 实测该 worklet 的 `rate` 对输出**没有任何影响**（rate=0.5/1/2 输出逐样本相同）
 *    ⇒ 拆掉挂载是**行为中性**的，预览听到的音频与之前完全一致。
 *
 * 因此这里只保留 `playbackRate` 这一条路径；`preservePitch` / `workletModuleUrl`
 * 两个入参保留（`_` 前缀）仅为兼容既有调用方，**不再有任何作用**。
 */
function applySpeed(
  _context: BaseAudioContext,
  source: AudioNode,
  speed: number,
  _preservePitch?: boolean,
  _workletModuleUrl?: string,
): AudioNode {
  const withRate = source as AudioNode & { playbackRate?: AudioParam };
  if (withRate.playbackRate) {
    withRate.playbackRate.value = speed;
  }
  return source;
}

/**
 * 应用淡入淡出包络（线性增益曲线）。
 */
export function applyFadeEnvelope(
  gain: GainNode,
  startMs: number,
  durationMs: number,
  fadeInMs: number,
  fadeOutMs: number,
  _context?: BaseAudioContext,
): void {
  const start = startMs / 1000;
  const end = (startMs + durationMs) / 1000;
  const param = gain.gain;

  if (fadeInMs > 0) {
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(1, start + fadeInMs / 1000);
  }

  if (fadeOutMs > 0) {
    param.setValueAtTime(1, Math.max(start, end - fadeOutMs / 1000));
    param.linearRampToValueAtTime(0, end);
  }
}

/**
 * 依据工程计算混音总线的时长（毫秒）。
 */
export function mixDurationMs(doc: ProjectDoc): number {
  let max = 0;
  for (const track of mixableTracks(doc)) {
    if (!isTrackAudible(track)) continue;
    for (const clip of track.clips) {
      if (clip.audio.muted) continue;
      max = Math.max(max, clip.startMs + clip.durationMs);
    }
  }
  return max;
}
