/**
 * 撤销 / 重做栈（FR-059）。
 *
 * - 每次编辑操作 = 一条记录（`{ undo, redo }` 两组 Immer patch）。
 * - 上限 100 步（要求 ≥ 50）。
 * - 工程保存成功后调用 `reset()` 清空。
 *
 * 本 store **不持有工程数据**，只管理 patch 栈，因此不会与 projectStore 形成循环依赖。
 */

import { create } from 'zustand';
import type { Patch } from 'immer';

/** 一条历史记录。 */
export interface HistoryEntry {
  /** 逆操作 patch（撤销用） */
  undo: Patch[];
  /** 正向 patch（重做用） */
  redo: Patch[];
}

/** 历史栈状态。 */
export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  limit: number;
  /** 压入一条历史记录。 */
  push: (undo: Patch[], redo: Patch[]) => void;
  /** 弹出撤销记录。 */
  popUndo: () => HistoryEntry | null;
  /** 弹出重做记录。 */
  popRedo: () => HistoryEntry | null;
  /** 清空全部历史。 */
  reset: () => void;
  /** 清空重做栈（发生新操作时调用）。 */
  clearFuture: () => void;
}

/** 历史栈上限。 */
export const HISTORY_LIMIT = 100;

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  past: [],
  future: [],
  limit: HISTORY_LIMIT,

  push: (undo, redo) => {
    const { limit } = get();
    const entry: HistoryEntry = { undo, redo };
    set((state) => {
      const nextPast = [...state.past, entry];
      // 超限时丢弃最旧的一条。
      const trimmed = nextPast.length > limit ? nextPast.slice(nextPast.length - limit) : nextPast;
      return { past: trimmed, future: [] };
    });
  },

  popUndo: () => {
    const { past } = get();
    if (past.length === 0) return null;
    const entry = past[past.length - 1];
    if (!entry) return null;
    set({ past: past.slice(0, -1) });
    return entry;
  },

  popRedo: () => {
    const { future } = get();
    if (future.length === 0) return null;
    const entry = future[future.length - 1];
    if (!entry) return null;
    set({ future: future.slice(0, -1) });
    return entry;
  },

  reset: () => {
    set({ past: [], future: [] });
  },

  clearFuture: () => {
    set({ future: [] });
  },
}));

/** 便捷读取：是否可以撤销。 */
export function canUndo(): boolean {
  return useHistoryStore.getState().past.length > 0;
}

/** 便捷读取：是否可以重做。 */
export function canRedo(): boolean {
  return useHistoryStore.getState().future.length > 0;
}
