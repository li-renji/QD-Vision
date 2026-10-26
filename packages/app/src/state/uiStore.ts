/**
 * 纯 UI 状态：选中、缩放、滚动、面板尺寸、吸附开关、对话框。
 *
 * 这里的状态**不进撤销栈**，也不触发工程数据变化。
 */

import { create } from 'zustand';
import type { AssetType } from '@clipcut/shared-types';
import { useProjectStore } from './projectStore.js';

/** 拖拽会话（瞬态，拖拽期间只影响极小组件）。 */
export interface DragSession {
  kind: 'move' | 'resize';
  /** 正在拖拽的 clip id */
  clipId: string;
  /** 原始起点（毫秒） */
  originStartMs: number;
  /** 原始 inMs */
  originInMs: number;
  /** 原始 outMs */
  originOutMs: number;
  /** 当前吸附命中的时间（毫秒），未命中为 null */
  snapMs: number | null;
  /** 当前吸附参考线的来源 */
  snapKind: 'playhead' | 'clip-start' | 'clip-end' | 'second' | null;
  /** 目标轨道 id（跨轨拖拽时） */
  targetTrackId: string | null;
}

/** 面板宽度。 */
export interface PanelWidths {
  media: number;
  inspector: number;
}

/** 素材筛选条件。 */
export interface MediaFilter {
  keyword: string;
  type: AssetType | 'all';
}

/** UI 状态。 */
export interface UiState {
  selectedClipIds: string[];
  /** 支持多选：被选中的轨道 id 集合（Ctrl/Shift 累加）。 */
  selectedTrackIds: string[];
  /** 时间线缩放（像素/秒），范围 0.5 ~ 200 */
  pxPerSecond: number;
  scrollLeft: number;
  /** 吸附开关 */
  snapEnabled: boolean;
  /** 吸附阈值（像素） */
  snapThresholdPx: number;
  dragSession: DragSession | null;
  panelWidths: PanelWidths;
  /** 当前打开的对话框 id */
  activeDialog: string | null;
  /** 素材面板视图模式 */
  mediaView: 'grid' | 'list';
  mediaFilter: MediaFilter;
  /** 属性面板当前分区 */
  inspectorTab: 'transform' | 'audio' | 'text' | 'subtitle' | 'export' | 'asset';
  /**
   * 预览画面**视图**缩放（1 = 适应窗口）。
   *
   * 纯视图变换，不写入工程数据；与 `zoomMode`（fit/fill/original）正交：
   * `zoomMode` 决定画布如何填满窗口，本项在其结果之上再做放大查看。
   */
  previewZoom: number;
  /** 预览平移（像素，仅 `previewZoom > 1` 时有意义）。 */
  previewPan: { x: number; y: number };

  setSelectedClipIds: (ids: string[]) => void;
  toggleSelectedClip: (id: string) => void;
  /** 选中轨道；additive=true 时与当前选中集合做累加/切换（多选）。 */
  setSelectedTrackId: (id: string, additive?: boolean) => void;
  setPxPerSecond: (value: number) => void;
  setScrollLeft: (value: number) => void;
  setSnapEnabled: (value: boolean) => void;
  setSnapThresholdPx: (value: number) => void;
  setDragSession: (session: DragSession | null) => void;
  setPanelWidth: (key: keyof PanelWidths, value: number) => void;
  setActiveDialog: (id: string | null) => void;
  setMediaView: (view: 'grid' | 'list') => void;
  setMediaFilter: (filter: Partial<MediaFilter>) => void;
  setInspectorTab: (tab: UiState['inspectorTab']) => void;
  setPreviewZoom: (value: number) => void;
  setPreviewPan: (pan: { x: number; y: number }) => void;
  /** 复位预览视图（缩放 1 + 平移归零）。 */
  resetPreviewView: () => void;
  /** 收敛选中项（删除 clip 后调用）。 */
  pruneSelection: (existingIds: ReadonlySet<string>) => void;
}

/** 预览视图缩放下限。 */
export const MIN_PREVIEW_ZOOM = 0.25;

/** 预览视图缩放上限。 */
export const MAX_PREVIEW_ZOOM = 8;

/** 缩放下限。 */
export const MIN_PX_PER_SECOND = 0.5;

/** 缩放上限。 */
export const MAX_PX_PER_SECOND = 200;

/** 选出拥有给定 clip 的所有轨道 id（去重保序）。 */
function trackIdsOwningClips(doc: { tracks: { id: string; clips: { id: string }[] }[] }, clipIds: string[]): string[] {
  if (clipIds.length === 0) return [];
  const set = new Set<string>();
  for (const track of doc.tracks) {
    if (track.clips.some((clip) => clipIds.includes(clip.id))) set.add(track.id);
  }
  return [...set];
}

/** 选出给定轨道上的全部 clip id（去重保序）。 */
function clipIdsOfTracks(doc: { tracks: { id: string; clips: { id: string }[] }[] }, trackIds: string[]): string[] {
  const set = new Set<string>();
  for (const track of doc.tracks) {
    if (trackIds.includes(track.id)) {
      for (const clip of track.clips) set.add(clip.id);
    }
  }
  return [...set];
}

export const useUiStore = create<UiState>()((set, get) => ({
  selectedClipIds: [],
  selectedTrackIds: [],
  pxPerSecond: 40,
  scrollLeft: 0,
  snapEnabled: true,
  snapThresholdPx: 8,
  dragSession: null,
  panelWidths: { media: 280, inspector: 320 },
  activeDialog: null,
  mediaView: 'grid',
  mediaFilter: { keyword: '', type: 'all' },
  inspectorTab: 'export',
  previewZoom: 1,
  previewPan: { x: 0, y: 0 },

  setSelectedClipIds: (ids) => {
    const next = [...new Set(ids)];
    const doc = useProjectStore.getState().doc;
    if (next.length === 0) {
      set({ selectedClipIds: [], selectedTrackIds: [] });
      return;
    }
    // 反向派生：选中 clip 时同步高亮其所属轨道（多 clip 跨多条轨道时全部高亮）。
    const trackIds = trackIdsOwningClips(doc, next);
    set({ selectedClipIds: next, selectedTrackIds: trackIds });
  },

  toggleSelectedClip: (id) => {
    const { selectedClipIds } = get();
    const next = selectedClipIds.includes(id)
      ? selectedClipIds.filter((item) => item !== id)
      : [...selectedClipIds, id];
    const doc = useProjectStore.getState().doc;
    const trackIds = next.length > 0 ? trackIdsOwningClips(doc, next) : [];
    set({ selectedClipIds: next, selectedTrackIds: trackIds });
  },

  setSelectedTrackId: (id, additive = false) => {
    const doc = useProjectStore.getState().doc;
    let trackIds: string[];
    if (additive) {
      const current = get().selectedTrackIds;
      trackIds = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
    } else {
      trackIds = [id];
    }
    // 选中整条/多条轨道 → 同步选中这些轨上的全部 clip，属性面板即可批量作用。
    const clipIds = clipIdsOfTracks(doc, trackIds);
    set({ selectedTrackIds: trackIds, selectedClipIds: clipIds });
  },

  setPxPerSecond: (value) => {
    const clamped = Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, value));
    set({ pxPerSecond: clamped });
  },

  setScrollLeft: (value) => {
    set({ scrollLeft: Math.max(0, value) });
  },

  setSnapEnabled: (value) => {
    set({ snapEnabled: value });
  },

  setSnapThresholdPx: (value) => {
    set({ snapThresholdPx: Math.max(0, value) });
  },

  setDragSession: (session) => {
    set({ dragSession: session });
  },

  setPanelWidth: (key, value) => {
    set((state) => ({ panelWidths: { ...state.panelWidths, [key]: Math.max(160, value) } }));
  },

  setActiveDialog: (id) => {
    set({ activeDialog: id });
  },

  setMediaView: (view) => {
    set({ mediaView: view });
  },

  setMediaFilter: (filter) => {
    set((state) => ({ mediaFilter: { ...state.mediaFilter, ...filter } }));
  },

  setInspectorTab: (tab) => {
    set({ inspectorTab: tab });
  },

  setPreviewZoom: (value) => {
    const clamped = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, value));
    // 回到 100% 时平移一并归零，避免内容停在偏移位置。
    if (clamped === 1) {
      set({ previewZoom: 1, previewPan: { x: 0, y: 0 } });
      return;
    }
    set({ previewZoom: clamped });
  },

  setPreviewPan: (pan) => {
    set({ previewPan: pan });
  },

  resetPreviewView: () => {
    set({ previewZoom: 1, previewPan: { x: 0, y: 0 } });
  },

  pruneSelection: (existingIds) => {
    const { selectedClipIds, selectedTrackIds } = get();
    const nextClips = selectedClipIds.filter((id) => existingIds.has(id));
    const existingTrackIds = new Set(useProjectStore.getState().doc.tracks.map((track) => track.id));
    const nextTracks = selectedTrackIds.filter((id) => existingTrackIds.has(id));
    if (nextClips.length !== selectedClipIds.length || nextTracks.length !== selectedTrackIds.length) {
      set({ selectedClipIds: nextClips, selectedTrackIds: nextTracks });
    }
  },
}));
