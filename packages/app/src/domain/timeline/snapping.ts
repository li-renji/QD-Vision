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

/**
 * 计算「拖素材入轨」的吸附起点（FR-021 · drop 侧规则）。
 *
 * 规则（与产品反馈一致）：
 * 1. **第一条轨道**放入**第一段** → 起点强制对齐 `0s`（硬规则，无视落点）；
 * 2. **同一轨道**内已有片段 → 新片段起点吸附到该轨最近的片段边界 / `0` / 播放头
 *    （仅在阈值内吸附，实现「同轨自动对齐、首尾相接」）；
 * 3. **不同轨道**之间不互相牵引：非首条轨道且该轨还没有片段时落点自由
 *    （例如第 2 条轨的第一段可放任意位置）。
 *
 * 纯函数、可单测；UI 只负责把 `rawStartMs`（落点）与缩放 / 阈值喂进来。
 */
export function computeDropStartMs(
  doc: ProjectDoc,
  targetTrackId: string,
  rawStartMs: number,
  playheadMs: number,
  pxPerSecond: number,
  thresholdPx: number = DEFAULT_SNAP_THRESHOLD_PX,
): number {
  const ordered = [...doc.tracks].sort((a, b) => a.order - b.order);
  const isFirstTrack = ordered.length > 0 && ordered[0]?.id === targetTrackId;
  const track = ordered.find((item) => item.id === targetTrackId);
  const clips = track ? [...track.clips].sort((a, b) => a.startMs - b.startMs) : [];
  const clampedRaw = Math.max(0, rawStartMs);

  // 规则 1：首条轨道的第一段 → 0s（硬规则）
  if (isFirstTrack && clips.length === 0) return 0;

  // 规则 3：非首条轨道且为空 → 落点自由
  if (clips.length === 0) return clampedRaw;

  // 规则 2：同轨已有片段 → 吸附到该轨片段边界 + 0 + 播放头
  const candidates: SnapCandidate[] = [
    { ms: 0, kind: 'second', clipId: null },
    { ms: Math.max(0, playheadMs), kind: 'playhead', clipId: null },
  ];
  for (const clip of clips) {
    candidates.push({ ms: clip.startMs, kind: 'clip-start', clipId: clip.id });
    candidates.push({ ms: clip.startMs + clip.durationMs, kind: 'clip-end', clipId: clip.id });
  }
  const hit = findSnap(clampedRaw, candidates, pxPerSecond, thresholdPx);
  return hit ? Math.max(0, hit.ms) : clampedRaw;
}
