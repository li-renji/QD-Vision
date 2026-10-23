/**
 * 时间线容器：轨道堆叠、标尺、播放头、滚动与缩放、快捷键作用域。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { useUiStore } from '../../state/uiStore.js';
import { orderedTracks } from '../../domain/timeline/selectors.js';
import { addClip } from '../../state/actions.js';
import { toast } from '../common/Toast.js';
import { TimelineToolbar } from './TimelineToolbar.js';
import { TimelineRuler } from './TimelineRuler.js';
import { TrackHeader } from './TrackHeader.js';
import { TrackRow } from './TrackRow.js';
import { Playhead } from './Playhead.js';
import { SnapIndicator } from './SnapIndicator.js';
import { useVirtualizedRows } from '../../hooks/useVirtualizedRows.js';

/**
 * 时间线面板。
 */
export function TimelinePanel(): JSX.Element {
  const { t } = useTranslation();
  const doc = useProjectStore((state) => state.doc);
  const assets = useProjectStore((state) => state.doc.assets);
  const selectedClipIds = useUiStore((state) => state.selectedClipIds);
  const selectedTrackId = useUiStore((state) => state.selectedTrackId);
  const setSelectedClipIds = useUiStore((state) => state.setSelectedClipIds);
  const toggleSelectedClip = useUiStore((state) => state.toggleSelectedClip);
  const setSelectedTrackId = useUiStore((state) => state.setSelectedTrackId);
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const setPxPerSecond = useUiStore((state) => state.setPxPerSecond);
  const scrollLeft = useUiStore((state) => state.scrollLeft);
  const setScrollLeft = useUiStore((state) => state.setScrollLeft);
  const dragSession = useUiStore((state) => state.dragSession);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(800);

  const tracks = orderedTracks(doc);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setViewportWidth(element.clientWidth);
    });
    observer.observe(element);
    setViewportWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const { startMs, endMs } = useVirtualizedRows(tracks, {
    viewportWidth,
    scrollLeft,
    pxPerSecond,
    pinnedClipIds: dragSession ? [dragSession.clipId] : [],
  });

  const handleSelectClip = useCallback(
    (clipId: string, additive: boolean): void => {
      if (additive) {
        toggleSelectedClip(clipId);
      } else {
        setSelectedClipIds([clipId]);
      }
    },
    [setSelectedClipIds, toggleSelectedClip],
  );

  // Ctrl+滚轮：以鼠标为锚点缩放
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const element = scrollRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const timeAtPointer = (scrollLeft + pointerX) / pxPerSecond;

    const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
    const next = Math.min(200, Math.max(0.5, pxPerSecond * factor));
    setPxPerSecond(next);

    const nextScroll = timeAtPointer * next - pointerX;
    setScrollLeft(Math.max(0, nextScroll));
    element.scrollLeft = Math.max(0, nextScroll);
  };

  const handleDropAsset = (assetId: string, trackId: string, clientX: number): void => {
    const asset = assets[assetId];
    if (!asset) return;

    const element = scrollRef.current;
    const rect = element?.getBoundingClientRect();
    const dropX = clientX - (rect?.left ?? 0);
    const startMs = Math.max(0, ((scrollLeft + dropX) / pxPerSecond) * 1000);

    const result = addClip({
      assetId,
      trackId,
      startMs,
      inMs: 0,
      ...(asset.durationMs > 0 ? { outMs: asset.durationMs } : {}),
    });
    if (!result.ok && result.error) toast(result.error, 'warning');
  };

  return (
    <div className="flex h-full flex-col" onWheel={handleWheel}>
      <TimelineToolbar />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-trackhead shrink-0 flex-col">
          <div className="h-6 shrink-0 border-b border-[var(--cc-border)] bg-[var(--cc-bg-elevated)]" />
          {tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              selected={selectedTrackId === track.id}
              onSelect={setSelectedTrackId}
            />
          ))}
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={(event) => {
            const next = event.currentTarget.scrollLeft;
            setScrollLeft(next);
          }}
        >
          <div className="relative" style={{ width: `${Math.max(viewportWidth, (endMs / 1000) * pxPerSecond)}px` }}>
            <TimelineRuler widthPx={Math.max(viewportWidth, (endMs / 1000) * pxPerSecond)} />

            <div className="relative flex flex-col">
              {tracks.map((track) => (
                <div key={track.id} className="flex">
                  <TrackRow
                    track={track}
                    assets={assets}
                    selectedClipIds={selectedClipIds}
                    selectedTrackId={selectedTrackId}
                    windowStartMs={startMs}
                    windowEndMs={endMs}
                    onSelectClip={handleSelectClip}
                    onSelectTrack={setSelectedTrackId}
                    onDropAsset={handleDropAsset}
                  />
                </div>
              ))}
            </div>

            <Playhead widthPx={Math.max(viewportWidth, (endMs / 1000) * pxPerSecond)} />
            <SnapIndicator widthPx={Math.max(viewportWidth, (endMs / 1000) * pxPerSecond)} />
          </div>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-[var(--cc-fg-muted)]">
          {t('timeline.empty')}
        </div>
      ) : null}
    </div>
  );
}
