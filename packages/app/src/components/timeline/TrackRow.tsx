/**
 * 单轨道行：承载 clip，绝对定位，接收虚拟化窗口。
 */

import { memo } from 'react';
import type { Asset, Track } from '@clipcut/shared-types';
import { useUiStore } from '../../state/uiStore.js';
import { ClipView } from './ClipView.js';
import { ASSET_DRAG_TYPE } from '../media/MediaCard.js';

/** TrackRow 属性。 */
export interface TrackRowProps {
  track: Track;
  assets: Record<string, Asset>;
  selectedClipIds: readonly string[];
  selectedTrackId: string | null;
  /** 虚拟化窗口（毫秒） */
  windowStartMs: number;
  windowEndMs: number;
  onSelectClip: (clipId: string, additive: boolean) => void;
  onSelectTrack: (trackId: string) => void;
  /** 素材拖入轨道。 */
  onDropAsset: (assetId: string, trackId: string, clientX: number) => void;
}

/**
 * 轨道行。
 */
export const TrackRow = memo(function TrackRow({
  track,
  assets,
  selectedClipIds,
  selectedTrackId,
  windowStartMs,
  windowEndMs,
  onSelectClip,
  onSelectTrack,
  onDropAsset,
}: TrackRowProps): JSX.Element {
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const dragSession = useUiStore((state) => state.dragSession);

  const visibleClips = track.clips.filter((clip) => {
    if (dragSession?.clipId === clip.id) return true;
    const clipEnd = clip.startMs + clip.durationMs;
    return clipEnd >= windowStartMs && clip.startMs <= windowEndMs;
  });

  return (
    <div
      className={`relative flex-1 overflow-hidden border-b border-[var(--cc-border)] ${
        selectedTrackId === track.id ? 'bg-[var(--cc-bg-elevated)]' : 'bg-[var(--cc-bg-track)]'
      }`}
      style={{ height: track.height }}
      onClick={() => onSelectTrack(track.id)}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
        if (assetId) onDropAsset(assetId, track.id, event.clientX);
      }}
    >
      {visibleClips.map((clip) => (
        <div
          key={clip.id}
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
