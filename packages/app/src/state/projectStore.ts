/**
 * 工程唯一数据源（ARCHITECTURE §8.1）。
 *
 * `doc` 只能通过 `applyOperation()` 修改 —— 这是全项目**唯一**的写入口。
 * 撤销 / 重做也走这里，保证历史栈与工程状态始终一致。
 */

import { create } from 'zustand';
import { applyPatches } from 'immer';
import type { ProjectDoc } from '@clipcut/shared-types';
import { createEmptyProject } from '../domain/project/factory.js';
import type { OperationContext, OperationResult } from '../domain/timeline/operations.js';
import { useHistoryStore } from './historyStore.js';

/** 工程状态。 */
export interface ProjectState {
  /** 当前工程。 */
  doc: ProjectDoc;
  /** 是否有未保存的修改。 */
  dirty: boolean;
  /**
   * 执行一次领域操作：更新 doc、写入历史栈。
   *
   * @param operation 领域层的纯函数操作
   */
  applyOperation: (operation: (ctx: OperationContext) => OperationResult) => OperationResult;
  /** 直接替换工程（打开工程 / 撤销重做 / 导入）。 */
  setDoc: (doc: ProjectDoc, options?: { markDirty?: boolean }) => void;
  /** 标记已保存。 */
  markSaved: () => void;
  /** 撤销一步。 */
  undo: () => boolean;
  /** 重做一步。 */
  redo: () => boolean;
}

/** 创建一个空白工程作为初始状态。 */
function initialDoc(): ProjectDoc {
  const doc = createEmptyProject();
  return { ...doc, projectId: '' };
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  doc: initialDoc(),
  dirty: false,

  applyOperation: (operation) => {
    const { doc } = get();
    const result = operation({ doc, assets: doc.assets });
    set({ doc: result.doc, dirty: true });
    useHistoryStore.getState().push(result.inversePatches, result.patches);
    return result;
  },

  setDoc: (doc, options) => {
    set({ doc, dirty: options?.markDirty ?? false });
  },

  markSaved: () => {
    set({ dirty: false });
  },

  undo: () => {
    const history = useHistoryStore.getState();
    const entry = history.popUndo();
    if (!entry) return false;
    const { doc } = get();
    const next = applyPatches(doc, entry.undo);
    set({ doc: next, dirty: true });
    useHistoryStore.setState((state) => ({ future: [...state.future, entry] }));
    return true;
  },

  redo: () => {
    const history = useHistoryStore.getState();
    const entry = history.popRedo();
    if (!entry) return false;
    const { doc } = get();
    const next = applyPatches(doc, entry.redo);
    set({ doc: next, dirty: true });
    useHistoryStore.setState((state) => ({ past: [...state.past, entry] }));
    return true;
  },
}));

/** 便捷读取：当前工程。 */
export function getProjectDoc(): ProjectDoc {
  return useProjectStore.getState().doc;
}
