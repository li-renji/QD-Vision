/**
 * 吸附系统（FR-021）。
 *
 * 候选点：播放头 / 其他 clip 的首尾 / 整秒刻度。
 * 命中阈值：8px（换算为时间后比较）。
 */

import type { ProjectDoc } from '@clipcut/shared-types';

/** 吸附候选点。 */
export interface SnapCandidate {
  /** 时间（毫秒） */
  ms: number;
  /** 候选来源，用于 UI 区分参考线样式 */
  kind: 'playhead' | 'clip-start' | 'clip-end' | 'second';
  /** 所属 clip id（整秒刻度与播放头为 null） */
  clipId: string | null;
}

/** 吸附命中结果。 */
export interface SnapResult {
  /** 吸附后的时间（毫秒） */
  ms: number;
  /** 命中的候选点 */
  candidate: SnapCandidate;
  /** 吸附前后的偏移（毫秒） */
  deltaMs: number;
}

/** 默认命中阈值（像素）。 */
export const DEFAULT_SNAP_THRESHOLD_PX = 8;

/**
 * 收集吸附候选点。
 *
 * @param doc 工程
 * @param excludeClipIds 需要排除的 clip（通常是正在拖拽的 clip）
 * @param playheadMs 播放头位置
 */
export function collectSnapCandidates(
  doc: ProjectDoc,
  excludeClipIds: readonly string[] = [],
  playheadMs: number | null = null,
): SnapCandidate[] {
  const excluded = new Set(excludeClipIds);
  const candidates: SnapCandidate[] = [];

  if (playheadMs !== null) {
    candidates.push({ ms: playheadMs, kind: 'playhead', clipId: null });
  }

  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) continue;
      candidates.push({ ms: clip.startMs, kind: 'clip-start', clipId: clip.id });
      candidates.push({ ms: clip.startMs + clip.durationMs, kind: 'clip-end', clipId: clip.id });
    }
  }

  return candidates;
}

/**
 * 收集整秒刻度候选点（0s、1s、2s……）。
 */
export function collectSecondTicks(fromMs: number, toMs: number): SnapCandidate[] {
  const ticks: SnapCandidate[] = [];
  const start = Math.max(0, Math.floor(fromMs / 1000) * 1000);
  for (let ms = start; ms <= toMs; ms += 1000) {
    ticks.push({ ms, kind: 'second', clipId: null });
  }
  return ticks;
}

/**
 * 在候选点中查找命中项。
 *
 * @param candidateMs 待吸附的时间（毫秒）
 * @param candidates 候选点
 * @param pxPerSecond 当前缩放比例
 * @param thresholdPx 命中阈值（像素），默认 8px
 * @returns 命中结果；未命中返回 null
 */
export function findSnap(
  candidateMs: number,
  candidates: readonly SnapCandidate[],
  pxPerSecond: number,
  thresholdPx: number = DEFAULT_SNAP_THRESHOLD_PX,
): SnapResult | null {
  if (candidates.length === 0 || pxPerSecond <= 0) return null;

  const thresholdMs = (thresholdPx / pxPerSecond) * 1000;
  let best: SnapResult | null = null;

  for (const candidate of candidates) {
    const deltaMs = candidate.ms - candidateMs;
    if (Math.abs(deltaMs) > thresholdMs) continue;
    if (!best || Math.abs(deltaMs) < Math.abs(best.deltaMs)) {
      best = { ms: candidate.ms, candidate, deltaMs };
    }
  }

  return best;
}
