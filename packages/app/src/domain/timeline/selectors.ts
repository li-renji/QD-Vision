/**
 * 时间线派生查询。
 */

import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';

/** clip 在时间线上的结束时间。 */
export function clipEndMs(clip: Clip): number {
  return clip.startMs + clip.durationMs;
}

/** 按 `order` 升序排列轨道（数值小者在下层）。 */
export function orderedTracks(doc: ProjectDoc): Track[] {
  return [...doc.tracks].sort((a, b) => a.order - b.order);
}

/** 参与预览渲染的视频轨（排除 `hidden`），按 `order` 升序。 */
export function visibleVideoTracks(doc: ProjectDoc): Track[] {
  return orderedTracks(doc).filter((track) => track.type === 'video' && !track.hidden);
}

/** 文字轨（按 `order` 升序）。 */
export function textTracks(doc: ProjectDoc): Track[] {
  return orderedTracks(doc).filter((track) => track.type === 'text');
}

/** 查找 clip 及其所属轨道。 */
export function findClip(
  doc: ProjectDoc,
  clipId: string,
): { clip: Clip; track: Track } | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

/** 查找轨道。 */
export function findTrack(doc: ProjectDoc, trackId: string): Track | null {
  return doc.tracks.find((track) => track.id === trackId) ?? null;
}

/**
 * 某一时刻处于活动状态的 clip（按轨道 `order` 升序）。
 */
export function clipsAtTime(doc: ProjectDoc, ms: number): Clip[] {
  const result: Clip[] = [];
  for (const track of orderedTracks(doc)) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (ms >= clip.startMs && ms < clipEndMs(clip)) result.push(clip);
    }
  }
  return result;
}

/** 某一时刻处于活动状态的画中画 clip（按 `zIndex` 升序）。 */
export function overlayClipsAtTime(doc: ProjectDoc, ms: number): Clip[] {
  return clipsAtTime(doc, ms)
    .filter((clip) => clip.isOverlay)
    .sort((a, b) => a.zIndex - b.zIndex);
}

/** 某轨道上在指定时刻的 clip。 */
export function clipAtTimeOnTrack(track: Track, ms: number): Clip | null {
  return track.clips.find((clip) => ms >= clip.startMs && ms < clipEndMs(clip)) ?? null;
}

/** 某轨道上所有 clip 的总时长（毫秒）。 */
export function trackDurationMs(track: Track): number {
  return track.clips.reduce((max, clip) => Math.max(max, clipEndMs(clip)), 0);
}

/**
 * 分割危险区判定结果（FR-018③）。
 */
export interface SplitDangerZone {
  /** 当前播放头位置**不可**分割 */
  blocked: boolean;
  /** 左侧时长（毫秒） */
  leftMs: number;
  /** 右侧时长（毫秒） */
  rightMs: number;
  /** 两侧都需达到的下限（毫秒） */
  minMs: number;
  /** 帧周期（毫秒） */
  frameMs: number;
  /** 建议动作方向 */
  action: 'move-right' | 'move-left' | 'none';
  /** 可分割的最早位置（毫秒，绝对时间） */
  minAtMs: number;
  /** 可分割的最晚位置（毫秒，绝对时间） */
  maxAtMs: number;
}

/**
 * 判定某个 clip 在指定位置能否分割，并给出**可执行的替代动作**。
 *
 * ## 为什么需要「前置预防」
 *
 * 分割失败若只在点击后报错，用户会反复重试同一位置，体验上等同于软件坏了
 * （FR-018③）。因此 UI 必须在**点击前**就知道危险区并禁用按钮。
 *
 * ## 判定规则
 *
 * 1. 距首尾不足 1 帧 → 不可分割（`frame-too-close`）；
 * 2. 分割后任一侧 < 下限 → 不可分割（`too-short`）；
 * 3. 否则可分割。
 *
 * @param clip 目标 clip
 * @param atMs 播放头位置（毫秒，绝对时间）
 * @param frameMs 帧周期（毫秒）
 * @param minMs 两侧各自需达到的最小时长（毫秒）
 */
export function evaluateSplitAt(
  clip: Clip,
  atMs: number,
  frameMs: number,
  minMs: number,
): SplitDangerZone {
  const clipStart = clip.startMs;
  const clipEnd = clip.startMs + clip.durationMs;
  const at = Math.round(atMs);
  const leftMs = at - clipStart;
  const rightMs = clipEnd - at;

  // 可分割区间：两侧都满足「≥ 下限」且距首尾 ≥ 1 帧
  const minAtMs = Math.max(clipStart + minMs, clipStart + frameMs);
  const maxAtMs = Math.min(clipEnd - minMs, clipEnd - frameMs);

  const tooCloseToEdge = at <= clipStart + frameMs || at >= clipEnd - frameMs;
  const tooShort = leftMs < minMs || rightMs < minMs;
  const blocked = tooCloseToEdge || tooShort;

  let action: SplitDangerZone['action'] = 'none';
  if (blocked) {
    if (leftMs < minMs) action = 'move-right';
    else if (rightMs < minMs) action = 'move-left';
    else action = 'move-right'; // 距边缘太近：往中间移
  }

  return {
    blocked,
    leftMs,
    rightMs,
    minMs,
    frameMs,
    action,
    minAtMs,
    maxAtMs,
  };
}

/**
 * 判定工程在指定位置能否分割（自动找到该位置命中的 clip）。
 *
 * @param doc 工程
 * @param atMs 播放头位置（毫秒）
 * @param frameMs 帧周期（毫秒）
 * @param minMs 两侧各自需达到的最小时长（毫秒）
 * @returns 判定结果；该位置没有任何 clip 时返回 null
 */
export function evaluateSplitAtTime(
  doc: ProjectDoc,
  atMs: number,
  frameMs: number,
  minMs: number,
): SplitDangerZone | null {
  for (const track of orderedTracks(doc)) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (atMs < clip.startMs || atMs >= clipEndMs(clip)) continue;
      return evaluateSplitAt(clip, atMs, frameMs, minMs);
    }
  }
  return null;
}
