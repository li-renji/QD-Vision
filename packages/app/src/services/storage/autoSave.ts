/**
 * 自动保存调度器（FR-005）。
 *
 * - 编辑后 **3s 防抖**落盘；
 * - `beforeunload` + `visibilitychange(hidden)` 双保险强制落盘；
 * - 落盘只更新 `updatedAt`，**不产生新版本号**（FR-005②）；
 * - 落盘失败（配额超限）不阻塞编辑，只回调上报。
 */

import { DEFAULT_AUTOSAVE_DEBOUNCE_MS } from '@clipcut/shared-types';
import type { ProjectDoc } from '@clipcut/shared-types';
import { debounce, type DebouncedFunction } from '../../utils/throttle.js';

/** 自动保存配置。 */
export interface AutoSaveOptions {
  /** 取得当前工程。 */
  getDoc: () => ProjectDoc | null;
  /** 落盘。 */
  save: (doc: ProjectDoc) => Promise<void>;
  /** 防抖时长（毫秒），默认 3000。 */
  delayMs?: number;
  /** 落盘失败回调（用于 Toast 提示）。 */
  onError?: (error: unknown) => void;
}

/** 落盘结果。 */
export interface AutoSaveHandle {
  /** 立即落盘（跳过防抖）。 */
  flush: () => Promise<void>;
  /** 取消挂起的落盘。 */
  cancel: () => void;
  /** 当前是否有挂起的落盘。 */
  isPending: () => boolean;
}

/** 更新 `updatedAt`（不改 `schemaVersion`）。 */
export function withUpdatedTimestamp(doc: ProjectDoc, now: Date = new Date()): ProjectDoc {
  return { ...doc, updatedAt: now.toISOString() };
}

/**
 * 创建一个自动保存调度器。
 */
export function createAutoSaver(options: AutoSaveOptions): AutoSaveHandle {
  const delayMs = options.delayMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  let running = false;

  const doSave = async (): Promise<void> => {
    const doc = options.getDoc();
    if (!doc) return;
    if (running) return;
    running = true;
    try {
      await options.save(withUpdatedTimestamp(doc));
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };

  const debounced = debounce(() => {
    void doSave();
  }, delayMs);

  return {
    flush: async (): Promise<void> => {
      debounced.cancel();
      await doSave();
    },
    cancel: (): void => {
      debounced.cancel();
    },
    isPending: (): boolean => debounced.pending,
  };
}

/**
 * 安排一次自动保存（3s 防抖）。
 *
 * 适合挂在 store 订阅上：每次工程变更调用一次即可。
 */
export function scheduleAutoSave(options: AutoSaveOptions): DebouncedFunction<[]> {
  const delayMs = options.delayMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  return debounce(() => {
    const doc = options.getDoc();
    if (!doc) return;
    void options
      .save(withUpdatedTimestamp(doc))
      .catch((error: unknown) => {
        options.onError?.(error);
      });
  }, delayMs);
}

/**
 * 安装 `beforeunload` + `visibilitychange` 强制落盘。
 *
 * @returns 卸载函数。
 */
export function installBeforeUnloadFlush(flush: () => void | Promise<void>): () => void {
  const runFlush = (): void => {
    void flush();
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') runFlush();
  };

  window.addEventListener('beforeunload', runFlush);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('beforeunload', runFlush);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
