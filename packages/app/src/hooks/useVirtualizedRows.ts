/**
 * 时间线视口虚拟化。
 *
 * 按 `scrollLeft` / `pxPerSecond` 计算可见时间窗，只挂载窗口内的 clip
 * （前后各留 1 屏 overscan）。**拖拽中的 clip 强制保持挂载**。
 */

import { useMemo } from 'react';
import type { Clip, Track } from '@clipcut/shared-types';

/** 虚拟化参数。 */
export interface VirtualizedRowsOptions {
  /** 视口宽度（像素） */
  viewportWidth: number;
  /** 横向滚动位置（像素） */
  scrollLeft: number;
  /** 缩放（像素/秒） */
  pxPerSecond: number;
  /** 需要保持挂载的 clip id（拖拽中） */
  pinnedClipIds?: readonly string[];
}

/** 虚拟化结果。 */
export interface VirtualizedRowsResult {
  /** 可见时间窗（毫秒） */
  startMs: number;
  endMs: number;
  /** 过滤后的 clip */
  visibleClips: Clip[];
  /** 判断某个 clip 是否需要挂载 */
  isVisible: (clip: Clip) => boolean;
}

/** overscan 屏数。 */
export const OVERSCAN_SCREENS = 1;

/**
 * 计算可见时间窗与需要渲染的 clip。
 */
export function useVirtualizedRows(
  tracks: readonly Track[],
  options: VirtualizedRowsOptions,
): VirtualizedRowsResult {
  const { viewportWidth, scrollLeft, pxPerSecond, pinnedClipIds = [] } = options;

  return useMemo(() => {
    const safePxPerSecond = pxPerSecond > 0 ? pxPerSecond : 1;
    const overscanPx = viewportWidth * OVERSCAN_SCREENS;
    const startPx = Math.max(0, scrollLeft - overscanPx);
    const endPx = scrollLeft + viewportWidth + overscanPx;

    const startMs = (startPx / safePxPerSecond) * 1000;
    const endMs = (endPx / safePxPerSecond) * 1000;

    const pinned = new Set(pinnedClipIds);

    const isVisible = (clip: Clip): boolean => {
      if (pinned.has(clip.id)) return true;
      const clipEnd = clip.startMs + clip.durationMs;
      return clipEnd >= startMs && clip.startMs <= endMs;
    };

    const visibleClips: Clip[] = [];
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (isVisible(clip)) visibleClips.push(clip);
      }
    }

    return { startMs, endMs, visibleClips, isVisible };
  }, [tracks, viewportWidth, scrollLeft, pxPerSecond, pinnedClipIds]);
}
