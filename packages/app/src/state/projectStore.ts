/**
 * 工程唯一数据源（ARCHITECTURE §8.1）。
 *
 * `doc` 只能通过 `applyOperation()` 修改 —— 这是全项目**唯一**的写入口。
 * 撤销 / 重做也走这里，保证历史栈与工程状态始终一致。
 *
 * ## `meta.durationMs` 由本层维护
 *
 * `meta.durationMs` 是**缓存的派生量**（ARCHITECTURE §5.1）：它只在
 * `serialize()` / `deserialize()` 里被重算，而**编辑路径不会刷新**。
 * 后果是新建工程里加了 clip 之后它仍是 0，而全有 6 处直接读它：
 *时间线总长显示、`跳到结尾`、自动保存索引、**以及 `exportPlan` 的导出时长**
 * —— 最后一项会让**导出的视频长度为 0**。
 *
 * 因此这里在每次写入（`applyOperation` / `undo` / `redo` / `setDoc`）后
 * 统一重算，使 `doc.meta.durationMs` 始终与轨道内容一致。
 * 领域层的纯函数 `computeProjectDuration` 仍是**唯一计算实现**。
 */

import { create } from 'zustand';
import { applyPatches } from 'immer';
import type { ProjectDoc } from '@clipcut/shared-types';
import { createEmptyProject } from '../domain/project/factory.js';
import { computeProjectDuration } from '../domain/project/duration.js';
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

/**
 * 刷新派生量 `meta.durationMs`（值未变时返回原对象，避免多余重渲染）。
 *
 * 这是 `meta.durationMs` 的**唯一**刷新点：所有写入路径都必须经过它，
 * 否则时间线总长、`跳到结尾`、自动保存索引与 `exportPlan` 会读到陈旧值。
 */
function withFreshDuration(doc: ProjectDoc): ProjectDoc {
  const expected = computeProjectDuration(doc);
  if (doc.meta.durationMs === expected) return doc;
  return { ...doc, meta: { ...doc.meta, durationMs: expected } };
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  doc: initialDoc(),
  dirty: false,

  applyOperation: (operation) => {
    const { doc } = get();
    const result = operation({ doc, assets: doc.assets });
    // 刷新派生量 durationMs（在写入历史之后，撤销/重做会各自再刷一次）
    set({ doc: withFreshDuration(result.doc), dirty: true });
    useHistoryStore.getState().push(result.inversePatches, result.patches);
    return result;
  },

  setDoc: (doc, options) => {
    set({ doc: withFreshDuration(doc), dirty: options?.markDirty ?? false });
  },

  markSaved: () => {
    set({ dirty: false });
  },

  undo: () => {
    const history = useHistoryStore.getState();
    const entry = history.popUndo();
    if (!entry) return false;
    const { doc } = get();
    // patches 只覆盖领域字段，`meta.durationMs` 需按撤销后的轨道内容重算
    const next = withFreshDuration(applyPatches(doc, entry.undo));
    set({ doc: next, dirty: true });
    useHistoryStore.setState((state) => ({ future: [...state.future, entry] }));
    return true;
  },

  redo: () => {
    const history = useHistoryStore.getState();
    const entry = history.popRedo();
    if (!entry) return false;
    const { doc } = get();
    const next = withFreshDuration(applyPatches(doc, entry.redo));
    set({ doc: next, dirty: true });
    useHistoryStore.setState((state) => ({ past: [...state.past, entry] }));
    return true;
  },
}));

/** 便捷读取：当前工程。 */
export function getProjectDoc(): ProjectDoc {
  return useProjectStore.getState().doc;
}
