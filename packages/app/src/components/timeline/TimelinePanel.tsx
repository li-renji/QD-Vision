/**
 * 时间线容器：轨道堆叠、标尺、播放头、滚动与缩放、快捷键作用域。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackType } from '@clipcut/shared-types';
import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { useUiStore } from '../../state/uiStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { orderedTracks } from '../../domain/timeline/selectors.js';
import { computeDropStartMs } from '../../domain/timeline/snapping.js';
import { addClip, addClipToAutoTrack } from '../../state/actions.js';
import { importFiles } from '../../services/media/assetService.js';
import { toast } from '../common/Toast.js';
import { ASSET_DRAG_TYPE } from '../media/MediaCard.js';
import { hitTestTrack } from '../../hooks/useClipDrag.js';
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

  // 拖拽浮层（轨道内黑色提示）：只在时间线区域显示，非全屏。
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const snapThresholdPx = useUiStore((state) => state.snapThresholdPx);

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

  // 落点 clientX → 未吸附的原始起点（毫秒）。
  const rawStartFromClientX = (clientX: number): number => {
    const element = scrollRef.current;
    const rect = element?.getBoundingClientRect();
    const dropX = clientX - (rect?.left ?? 0);
    return Math.max(0, ((scrollLeft + dropX) / pxPerSecond) * 1000);
  };

  // 吸附后的起点（开启吸附时套用 FR-021 drop 规则；关闭则原样返回）。
  const snappedStart = (targetTrackId: string, rawStartMs: number): number => {
    if (!snapEnabled) return rawStartMs;
    return computeDropStartMs(
      doc,
      targetTrackId,
      rawStartMs,
      usePlaybackStore.getState().currentTimeMs,
      pxPerSecond,
      snapThresholdPx,
    );
  };

  const handleDropAsset = (assetId: string, trackId: string, clientX: number): void => {
    const asset = assets[assetId];
    if (!asset) return;
    const startMs = snappedStart(trackId, rawStartFromClientX(clientX));

    const result = addClip({
      assetId,
      trackId,
      startMs,
      inMs: 0,
      ...(asset.durationMs > 0 ? { outMs: asset.durationMs } : {}),
    });
    if (result.ok) {
      // 拖进来就把播放头移到片段起点 —— 预览立即可见（修复「拖进来黑屏/没动静」的观感）。
      usePlaybackStore.getState().setCurrentTime(startMs);
    } else if (result.error) {
      toast(result.error, 'warning');
    }
  };

  // 拖到**空时间线**（无轨道）：按需建轨并放入素材。第一段落到首条轨 → 0s。
  const handleDropAssetToAutoTrack = (assetId: string, clientX: number): void => {
    const asset = assets[assetId];
    if (!asset) return;
    const startMs = tracks.length === 0 ? 0 : rawStartFromClientX(clientX);

    const result = addClipToAutoTrack({
      assetId,
      startMs,
      inMs: 0,
      ...(asset.durationMs > 0 ? { outMs: asset.durationMs } : {}),
    });
    if (result.ok) {
      usePlaybackStore.getState().setCurrentTime(startMs);
    } else if (result.error) {
      toast(result.error, 'warning');
    }
  };

  // 拖入 OS 文件到时间线：内联导入并放入轨道（替代全屏「松开以导入素材」提示窗）。
  // `targetTrackId` 命中具体轨道时用 `addClip` 精确落轨；为空（空时间线）时按需建轨。
  const handleFilesDrop = async (
    files: File[],
    clientX: number,
    preferTrackType?: TrackType,
    targetTrackId?: string,
  ): Promise<void> => {
    const result = await importFiles(files);
    if (result.failed > 0) {
      toast(t('media.imported', { imported: result.imported, failed: result.failed }), 'warning');
    }
    let startMs =
      targetTrackId !== undefined
        ? snappedStart(targetTrackId, rawStartFromClientX(clientX))
        : tracks.length === 0
          ? 0
          : rawStartFromClientX(clientX);
    let firstStart: number | null = null;
    for (const asset of result.assets) {
      const base = {
        assetId: asset.id,
        startMs,
        inMs: 0,
        ...(asset.durationMs > 0 ? { outMs: asset.durationMs } : {}),
      };
      const r =
        targetTrackId !== undefined
          ? addClip({ ...base, trackId: targetTrackId })
          : addClipToAutoTrack({ ...base, ...(preferTrackType ? { preferTrackType } : {}) });
      if (!r.ok && r.error) toast(r.error, 'warning');
      if (r.ok && firstStart === null) firstStart = startMs;
      startMs += asset.durationMs > 0 ? asset.durationMs : 3000;
    }
    if (firstStart !== null) {
      usePlaybackStore.getState().setCurrentTime(firstStart);
    }
  };

  // ============ 统一拖拽（轨道内浮层 + 命中轨道才导入） ============

  const hasDropPayload = (event: React.DragEvent): boolean => {
    const types = Array.from(event.dataTransfer.types);
    return types.includes(ASSET_DRAG_TYPE) || types.includes('Files');
  };

  const onTimelineDragEnter = (event: React.DragEvent): void => {
    if (!hasDropPayload(event)) return;
    event.preventDefault();
    event.stopPropagation(); // 阻止全屏 FileDropOverlay
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const onTimelineDragOver = (event: React.DragEvent): void => {
    if (!hasDropPayload(event)) return;
    event.preventDefault();
    event.stopPropagation(); // 阻止全屏 FileDropOverlay
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  const onTimelineDragLeave = (): void => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const onTimelineDrop = (event: React.DragEvent): void => {
    if (!hasDropPayload(event)) return;
    event.preventDefault();
    event.stopPropagation(); // 阻止窗口级 useFileDrop 误导入（避免孤儿素材）
    dragDepthRef.current = 0;
    setDragActive(false);

    const targetTrackId = hitTestTrack(event.clientX, event.clientY);
    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) {
      if (targetTrackId) {
        handleDropAsset(assetId, targetTrackId, event.clientX);
      } else if (tracks.length === 0) {
        handleDropAssetToAutoTrack(assetId, event.clientX);
      }
      // 有轨道却没命中任何轨道 → 不导入（避免素材面板冒出孤儿素材）
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    if (targetTrackId) {
      const track = tracks.find((item) => item.id === targetTrackId);
      void handleFilesDrop(files, event.clientX, track?.type, targetTrackId);
    } else if (tracks.length === 0) {
      void handleFilesDrop(files, event.clientX);
    }
  };

  return (
    <div className="flex h-full flex-col" onWheel={handleWheel}>
      <TimelineToolbar />

      {/* 时间线区域：统一接管拖放（命中轨道才导入），并显示轨道内拖拽提示浮层。 */}
      <div
        data-timeline-area=""
        className="relative flex min-h-0 flex-1"
        onDragEnter={onTimelineDragEnter}
        onDragOver={onTimelineDragOver}
        onDragLeave={onTimelineDragLeave}
        onDrop={onTimelineDrop}
      >
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
          <div
            className="relative min-h-full"
            style={{ width: `${Math.max(viewportWidth, (endMs / 1000) * pxPerSecond)}px` }}
          >
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
                  />
                </div>
              ))}
            </div>

            {tracks.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--cc-fg-muted)]">
                {t('timeline.empty')}
              </div>
            ) : null}

            <Playhead widthPx={Math.max(viewportWidth, (endMs / 1000) * pxPerSecond)} />
            <SnapIndicator widthPx={Math.max(viewportWidth, (endMs / 1000) * pxPerSecond)} />
          </div>
        </div>

        {/* 轨道内拖拽提示：仅在时间线区域变黑 + 居中文字，不是全屏。 */}
        {dragActive ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/60">
            <div className="rounded-lg bg-[var(--cc-bg-panel)] px-6 py-4 text-sm text-[var(--cc-fg-primary)] shadow-2xl">
              {t('timeline.dropHint')}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
