/**
 * 跨 store 的组合选择器（memoized）。
 *
 * 组件用 `useStore(selector, shallow)` 订阅，保证细粒度重渲染：
 * 1080p 时间线 60fps 更新只重渲染受影响的 clip。
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Asset, Clip, ProjectDoc, Track } from '@clipcut/shared-types';
import { useProjectStore } from './projectStore.js';
import { useUiStore } from './uiStore.js';
import { clipEndMs, orderedTracks } from '../domain/timeline/selectors.js';

/** 选取工程文档。 */
export function useProjectDoc(): ProjectDoc {
  return useProjectStore((state) => state.doc);
}

/** 选取全部素材。 */
export function useAssets(): Record<string, Asset> {
  return useProjectStore((state) => state.doc.assets);
}

/** 选取素材列表（按 id 排序）。 */
export function useAssetList(): Asset[] {
  const assets = useAssets();
  return useMemo(() => Object.values(assets).sort((a, b) => a.importedAt.localeCompare(b.importedAt)), [assets]);
}

/** 选取轨道列表（按 `order` 升序）。 */
export function useOrderedTracks(): Track[] {
  const tracks = useProjectStore((state) => state.doc.tracks);
  return useMemo(() => orderedTracks({ tracks } as unknown as ProjectDoc), [tracks]);
}

/** 选取当前选中的 clip。 */
export function useSelectedClips(): Clip[] {
  const doc = useProjectStore((state) => state.doc);
  const selectedClipIds = useUiStore((state) => state.selectedClipIds);
  return useMemo(() => {
    const result: Clip[] = [];
    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        if (selectedClipIds.includes(clip.id)) result.push(clip);
      }
    }
    return result;
  }, [doc, selectedClipIds]);
}

/** 选取第一个选中的 clip。 */
export function usePrimarySelectedClip(): Clip | null {
  const clips = useSelectedClips();
  return clips[0] ?? null;
}

/** 选取某轨道上位于指定时间的 clip。 */
export function useClipAtTime(trackId: string, timeMs: number): Clip | null {
  const tracks = useProjectStore((state) => state.doc.tracks);
  return useMemo(() => {
    const track = tracks.find((item) => item.id === trackId);
    if (!track) return null;
    return track.clips.find((clip) => timeMs >= clip.startMs && timeMs < clipEndMs(clip)) ?? null;
  }, [tracks, trackId, timeMs]);
}

/** 选取工程总时长。 */
export function useProjectDuration(): number {
  return useProjectStore((state) => state.doc.meta.durationMs);
}

/** 选取画布设置。 */
export function useCanvasSettings() {
  return useProjectStore((state) => state.doc.settings.canvas);
}

/** 选取导出设置。 */
export function useExportSettings() {
  return useProjectStore((state) => state.doc.settings.export);
}

/** 选取字幕文档。 */
export function useSubtitles() {
  return useProjectStore((state) => state.doc.subtitles);
}

/** 选取当前的 active overlay clip 列表。 */
export function useActiveOverlayClips(timeMs: number): Clip[] {
  const doc = useProjectStore((state) => state.doc);
  return useMemo(() => {
    const result: Clip[] = [];
    for (const track of orderedTracks(doc)) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (!clip.isOverlay) continue;
        if (timeMs >= clip.startMs && timeMs < clipEndMs(clip)) result.push(clip);
      }
    }
    return result.sort((a, b) => a.zIndex - b.zIndex);
  }, [doc, timeMs]);
}

/** 选取当前可见（未隐藏）的视频轨。 */
export function useVisibleVideoTracks(): Track[] {
  const tracks = useOrderedTracks();
  return useMemo(() => tracks.filter((track) => track.type === 'video' && !track.hidden), [tracks]);
}

/** 选取选中的 clip id 集合（浅比较）。 */
export function useSelectedClipIds(): string[] {
  return useUiStore(useShallow((state) => state.selectedClipIds));
}
