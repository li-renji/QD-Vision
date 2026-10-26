/**
 * 单轨道行：承载 clip，绝对定位，接收虚拟化窗口。
 */

import { memo, useEffect, useRef } from 'react';
import type { Asset, Track } from '@clipcut/shared-types';
import { useUiStore } from '../../state/uiStore.js';
import { registerTrackElement, unregisterTrackElement } from '../../hooks/useClipDrag.js';
import { ClipView } from './ClipView.js';

/** TrackRow 属性。 */
export interface TrackRowProps {
  track: Track;
  assets: Record<string, Asset>;
  selectedClipIds: readonly string[];
  selectedTrackIds: readonly string[];
  /** 虚拟化窗口（毫秒） */
  windowStartMs: number;
  windowEndMs: number;
  onSelectClip: (clipId: string, additive: boolean) => void;
  onSelectTrack: (trackId: string, additive: boolean) => void;
}

/**
 * 轨道行。
 *
 * 拖放由父级 `TimelinePanel` 统一接管（按指针命中轨道），这里只负责渲染 clip、
 * 登记 DOM（供跨轨拖拽 / drop 命中）与点选。
 */
export const TrackRow = memo(function TrackRow({
  track,
  assets,
  selectedClipIds,
  selectedTrackIds,
  windowStartMs,
  windowEndMs,
  onSelectClip,
  onSelectTrack,
}: TrackRowProps): JSX.Element {
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const dragSession = useUiStore((state) => state.dragSession);

  // 登记自身 DOM，供跨轨拖拽按指针位置命中目标轨道。
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = rowRef.current;
    if (!element) return;
    registerTrackElement(track.id, element);
    return () => unregisterTrackElement(track.id);
  }, [track.id]);

  const visibleClips = track.clips.filter((clip) => {
    if (dragSession?.clipId === clip.id) return true;
    const clipEnd = clip.startMs + clip.durationMs;
    return clipEnd >= windowStartMs && clip.startMs <= windowEndMs;
  });

  return (
    <div
      ref={rowRef}
      data-track-row={track.id}
      className={`relative flex-1 overflow-hidden border-b border-[var(--cc-border)] ${
        selectedTrackIds.includes(track.id) ? 'bg-[var(--cc-bg-elevated)]' : 'bg-[var(--cc-bg-track)]'
      }`}
      style={{ height: track.height }}
      // 只有点空白处才选中轨道；点在 clip 上由 clip 自己处理（否则会冒泡覆盖 clip 多选）。
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-clip-id]')) return;
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        onSelectTrack(track.id, additive);
      }}
    >
      {visibleClips.map((clip) => (
        <div
          key={clip.id}
          data-clip-id={clip.id}
          className="absolute inset-y-0 left-0"
          style={{ transform: `translateX(${(clip.startMs / 1000) * pxPerSecond}px)` }}
        >
          <ClipView
            clip={clip}
            {...(clip.assetId && assets[clip.assetId] ? { asset: assets[clip.assetId] } : {})}
            trackId={track.id}
            trackLocked={track.locked}
            selected={selectedClipIds.includes(clip.id)}
            onSelect={onSelectClip}
          />
        </div>
      ))}
    </div>
  );
});
