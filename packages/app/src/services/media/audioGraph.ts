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
 * ## 做什么
 *
 * 1. `playbackRate = speed` —— 变速（时长正确）；
 * 2. `preservesPitch = true` —— **显式**保音高（PRD FR-020③）。
 *
 * 两者都作用在**音频源自身**上：
 * - 预览侧：`MediaElementAudioSourceNode` ⇒ 经其 `mediaElement` 引用拿到
 *   `<video>` / `<audio>` 元素来设置（元素自带这两条能力）；
 * - 导出侧：`AudioBufferSourceNode` ⇒ 只有 `playbackRate`，**没有**
 *   `preservesPitch` ⇒ 导出的变速音频音高会变（已由导出侧 warnings 告知）。
 *
 * ## ⚠️ 为什么 `preservesPitch` 必须显式设置
 *
 * 它的浏览器默认值恰好是 `true`，但**依赖默认值是脆弱的**：任何代码路径
 * （或未来的浏览器改动）把它设成 `false` 就会**静默变调**，而现有测试抓不到。
 * 因此这里显式写死。`software-engineer` 也会在元素创建处再设一次作为双保险。
 *
 * ## ⚠️ 已知限制：同一素材被多个不同 speed 的 clip 复用时，音频无法同时满足多个速率
 *
 * `previewFrameSource` 按 **assetId** 池化元素 —— 一个元素同一时刻只能有一个
 * `playbackRate`。两个不同 speed 的 clip 共用同一元素时，**后设置的覆盖前一个**。
 *
 * 这是池化架构的固有限制，**不是本函数引入的**：
 * - 画面侧能规避（按 clip 计算 `sourceTimeMs` 再 seek 共享元素，每帧重算）；
 * - 音频侧规避不了（元素只能真实播在一个位置、一个速率）。
 *
 * ⇒ 本轮不修。要修得改成「一个 clip 一个元素」（内存换正确性），
 * 或「只对当前播放头命中的 clip 设速，其余静音」。
 *
 * ## ⚠️ 曾经的做法（已拆除，勿回退）
 *
 * 这里曾同时设 `playbackRate` **和**挂 WSOLA worklet
 * （`processorOptions: { rate: speed }`）⇒ **速率被应用两次**，时长与音高都不对。
 *
 * 三条实测结论（别再修一遍）：
 * 1. WSOLA 是「时间伸缩」（改时长、**保**音高），它**不能还原音高** ——
 *    想「playbackRate 变速 + 补偿音高」需要 pitch shifter（PSOLA / 相位声码器），
 *    是另一个算法；worklet 的 `processorOptions` 只有 `rate` 一个字段。
 * 2. **有界缓冲的流式处理器做不了时间伸缩**：减速时「已到达但未消费」的素材积压
 *    无界增长（固定缓冲必然被冲掉）；加速则需要尚未到达的素材。
 * 3. 实测该 worklet 的 `rate` 对输出**没有任何影响**（rate=0.5/1/2 输出逐样本相同）
 *    ⇒ 拆掉挂载是**行为中性**的。
 *
 * 浏览器原生的 `preservesPitch` 就是 PRD FR-020③ 指定的机制，两方向都行、不截断。
 * 它由 `videoPool.acquire` 在元素创建时一次性设置（见该处注释）。
 */
function applySpeed(
  _context: BaseAudioContext,
  source: AudioNode,
  speed: number,
  _preservePitch?: boolean,
  _workletModuleUrl?: string,
): AudioNode {
  // 元素源（MediaElementAudioSourceNode）带 `mediaElement` 引用。
  //
  // ⚠️ 这里**只**设 playbackRate，不再设 `preservesPitch` ——
  // 保音高在元素**创建时**由 `videoPool.acquire` 一次性设置（那是元素生命
  // 周期的唯一入口，能覆盖 speed=1 的 clip；而 `applySpeed` 只在
  // `speed !== 1` 时才被调用）。两处都写同一个常量必然漂移。
  //
  // 注：`MediaElementAudioSourceNode` 自身**没有** `playbackRate` 这个
  // AudioParam（那是 `AudioBufferSourceNode` 的），所以下面这步对元素源
  // 是空操作 —— 预览侧真实的倍速由 `previewAudio.applyAssetSpeeds` 写到
  // `element.playbackRate` 上。
  const elementSource = source as AudioNode & {
    playbackRate?: AudioParam;
  };

  if (elementSource.playbackRate) {
    elementSource.playbackRate.value = speed;
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
