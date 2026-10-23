/**
 * 纯 UI 状态：选中、缩放、滚动、面板尺寸、吸附开关、对话框。
 *
 * 这里的状态**不进撤销栈**，也不触发工程数据变化。
 */

import { create } from 'zustand';
import type { AssetType } from '@clipcut/shared-types';

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
  selectedTrackId: string | null;
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

  setSelectedClipIds: (ids: string[]) => void;
  toggleSelectedClip: (id: string) => void;
  setSelectedTrackId: (id: string | null) => void;
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
  /** 收敛选中项（删除 clip 后调用）。 */
  pruneSelection: (existingIds: ReadonlySet<string>) => void;
}

/** 缩放下限。 */
export const MIN_PX_PER_SECOND = 0.5;

/** 缩放上限。 */
export const MAX_PX_PER_SECOND = 200;

export const useUiStore = create<UiState>()((set, get) => ({
  selectedClipIds: [],
  selectedTrackId: null,
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

  setSelectedClipIds: (ids) => {
    set({ selectedClipIds: [...ids] });
  },

  toggleSelectedClip: (id) => {
    const { selectedClipIds } = get();
    const next = selectedClipIds.includes(id)
      ? selectedClipIds.filter((item) => item !== id)
      : [...selectedClipIds, id];
    set({ selectedClipIds: next });
  },

  setSelectedTrackId: (id) => {
    set({ selectedTrackId: id });
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

  pruneSelection: (existingIds) => {
    const { selectedClipIds } = get();
    const next = selectedClipIds.filter((id) => existingIds.has(id));
    if (next.length !== selectedClipIds.length) {
      set({ selectedClipIds: next });
    }
  },
}));
