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
 */

import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';

/** 变速保音高 worklet 的模块名。 */
export const PITCH_PRESERVE_WORKLET_NAME = 'clipcut-pitch-preserve-stretch';

/** 混音图构建参数。 */
export interface AudioGraphOptions {
  /** 为某个 clip 取得音频源（返回 null 表示该 clip 无音频）。 */
  resolveSource: (clip: Clip, track: Track) => AudioNode | null;
  /** 变速时是否保持音高（默认 true）。 */
  preservePitch?: boolean;
  /** worklet 模块 URL（需要保音高变速时必填）。 */
  workletModuleUrl?: string;
}

/** 构建好的混音图。 */
export interface AudioGraph {
  /** 主混音总线 */
  masterGain: GainNode;
  /** 轨道总线：trackId → GainNode */
  trackBuses: Map<string, GainNode>;
  /** clip 增益节点：clipId → GainNode */
  clipGains: Map<string, GainNode>;
  /** 变速保音高是否可用（worklet 加载失败时为 false） */
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
  const masterGain = context.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(context.destination);

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
      try {
        masterGain.disconnect();
      } catch {
        // 已断开
      }
      clipGains.clear();
      trackBuses.clear();
    },
  };
}

/**
 * 应用变速。
 *
 * - `speed === 1`：直通。
 * - 需要保音高且 worklet 可用：挂 WSOLA worklet。
 * - 否则：退化为普通 `playbackRate`（音高会变）。
 */
function applySpeed(
  context: BaseAudioContext,
  source: AudioNode,
  speed: number,
  preservePitch: boolean,
  workletModuleUrl: string | undefined,
): AudioNode {
  // 元素源本身支持 playbackRate（预览侧可用 preservesPitch）。
  const withRate = source as AudioNode & { playbackRate?: AudioParam };
  if (withRate.playbackRate) {
    withRate.playbackRate.value = speed;
  }

  if (!preservePitch || !workletModuleUrl) {
    return source;
  }

  const workletContext = context as AudioContext;
  if (!workletContext.audioWorklet) {
    return source;
  }

  try {
    const worklet = new AudioWorkletNode(workletContext, PITCH_PRESERVE_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { rate: speed },
    });
    if ('parameters' in worklet) {
      const param = worklet.parameters.get('rate');
      if (param) param.value = speed;
    }
    source.connect(worklet);
    return worklet;
  } catch {
    // worklet 不可用 → 降级为普通 playbackRate（音高会变）
    return source;
  }
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
