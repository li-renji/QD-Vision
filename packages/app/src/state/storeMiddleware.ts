/**
 * 自定义中间件。
 *
 * 职责：
 * 1. 订阅 `projectStore` 变更 → 标脏 + 调度自动保存（3s 防抖）。
 * 2. 安装 `beforeunload` / `visibilitychange` 强制落盘。
 * 3. 工程变更后把 `selectedClipIds` 收敛到**仍存在**的 clip（避免悬空选中）。
 */

import type { ProjectDoc } from '@clipcut/shared-types';
import { useProjectStore } from './projectStore.js';
import { useUiStore } from './uiStore.js';
import { installBeforeUnloadFlush, scheduleAutoSave } from '../services/storage/autoSave.js';
import { saveProject } from '../services/storage/projectRepo.js';

/** 中间件配置。 */
export interface StoreMiddlewareOptions {
  /** 落盘实现（默认写入 IndexedDB）。 */
  save?: (doc: ProjectDoc) => Promise<void>;
  /** 自动保存防抖时长（毫秒）。 */
  delayMs?: number;
  /** 落盘失败回调。 */
  onError?: (error: unknown) => void;
}

/** 中间件返回值。 */
export interface StoreMiddlewareHandle {
  /** 立即落盘。 */
  flush: () => void;
  /** 卸载中间件。 */
  dispose: () => void;
}

let activeHandle: StoreMiddlewareHandle | null = null;

/**
 * 安装状态层中间件。
 *
 * 整个应用只在启动时安装一次；重复调用会先卸载旧实例。
 */
export function installStoreMiddleware(options: StoreMiddlewareOptions = {}): StoreMiddlewareHandle {
  activeHandle?.dispose();

  const save = options.save ?? saveProject;
  const schedule = scheduleAutoSave({
    getDoc: () => useProjectStore.getState().doc,
    save,
    ...(options.delayMs !== undefined ? { delayMs: options.delayMs } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
  });

  let lastDoc = useProjectStore.getState().doc;

  const unsubscribe = useProjectStore.subscribe((state) => {
    if (state.doc === lastDoc) return;
    lastDoc = state.doc;

    // 1) 标脏
    useProjectStore.setState({ dirty: true });

    // 2) 收敛选中项
    const existing = new Set<string>();
    for (const track of state.doc.tracks) {
      for (const clip of track.clips) existing.add(clip.id);
    }
    useUiStore.getState().pruneSelection(existing);

    // 3) 调度自动保存
    schedule();
  });

  const uninstallFlush = installBeforeUnloadFlush(() => {
    schedule.flush();
  });

  const handle: StoreMiddlewareHandle = {
    flush: () => {
      schedule.flush();
    },
    dispose: () => {
      schedule.cancel();
      unsubscribe();
      uninstallFlush();
      if (activeHandle === handle) activeHandle = null;
    },
  };

  activeHandle = handle;
  return handle;
}

/** 取得当前中间件实例（未安装时返回 null）。 */
export function getStoreMiddleware(): StoreMiddlewareHandle | null {
  return activeHandle;
}
