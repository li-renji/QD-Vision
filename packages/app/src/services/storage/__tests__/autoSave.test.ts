/**
 * 自动保存调度器测试（FR-005）。
 *
 * 覆盖三条主线：
 * 1. `withUpdatedTimestamp` —— 只刷新 `updatedAt`，**不动 `schemaVersion`**（FR-005②）；
 * 2. `scheduleAutoSave` —— 3s 防抖、脏判断（无工程不落盘）、失败上报、pending 状态；
 * 3. `installBeforeUnloadFlush` —— `beforeunload` / `visibilitychange(hidden)` 双保险；
 * 4. `createAutoSaver` —— 立即落盘、并发落盘锁、错误不外抛。
 *
 * ⚠️ 落盘失败**不得**阻断编辑（配额超限时只回调上报），这是本文件的核心断言之一。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOSAVE_DEBOUNCE_MS, type ProjectDoc } from '@clipcut/shared-types';
import { createEmptyProject } from '../../../domain/project/factory.js';
import { useProjectStore } from '../../../state/projectStore.js';
import {
  createAutoSaver,
  installBeforeUnloadFlush,
  scheduleAutoSave,
  withUpdatedTimestamp,
} from '../autoSave.js';

/** 固定「当前时间」，让 `updatedAt` 断言可预期。 */
const FIXED_NOW = new Date('2026-10-23T08:00:00.000Z');

/** 造一个带工程内容的小 doc（便于断言「其它字段不被改动」）。 */
function makeDoc(): ProjectDoc {
  // 用一个**早于** FIXED_NOW 的创建时间，保证 updatedAt 变化可被断言。
  const doc = createEmptyProject('自动保存测试工程', new Date('2020-01-01T00:00:00.000Z'));
  return { ...doc, projectId: 'p-autosave', schemaVersion: '1.0.0' };
}

/** 落盘 spy 的类型（`vi.fn` 需要显式参数类型才能推断 `mock.calls` 的元组）。 */
type SaveSpy = ReturnType<typeof vi.fn<(doc: ProjectDoc) => Promise<void>>>;

/** 造一个落盘 spy。 */
function makeSaveSpy(impl?: (doc: ProjectDoc) => Promise<void>): SaveSpy {
  return vi.fn<(doc: ProjectDoc) => Promise<void>>(impl ?? (async () => undefined));
}

/** 取出落盘 spy 收到的第一份工程（没有则直接失败，避免可选链掩盖断言）。 */
function firstSavedDoc(save: SaveSpy): ProjectDoc {
  const saved = save.mock.calls[0]?.[0];
  if (!saved) throw new Error('落盘未被调用');
  return saved;
}

/** 覆盖 `document.visibilityState`（happy-dom 默认恒为 visible）。 */
function setVisibilityState(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value,
    configurable: true,
  });
}

describe('services/storage/autoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  describe('withUpdatedTimestamp', () => {
    it('只刷新 updatedAt，schemaVersion 与其它字段保持不变', () => {
      const doc = makeDoc();
      const originalUpdatedAt = doc.updatedAt;

      const next = withUpdatedTimestamp(doc, FIXED_NOW);

      expect(next.updatedAt).toBe(FIXED_NOW.toISOString());
      expect(next.updatedAt).not.toBe(originalUpdatedAt);
      expect(next.schemaVersion).toBe(doc.schemaVersion);
      expect(next.projectId).toBe(doc.projectId);
      expect(next.name).toBe(doc.name);
      expect(next.tracks.length).toBe(doc.tracks.length);
    });

    it('不修改入参（返回新对象）', () => {
      const doc = makeDoc();
      const before = doc.updatedAt;

      const next = withUpdatedTimestamp(doc, new Date('2030-01-01T00:00:00.000Z'));

      expect(next).not.toBe(doc);
      expect(doc.updatedAt).toBe(before);
    });

    it('默认使用当前时间', () => {
      const doc = makeDoc();

      const next = withUpdatedTimestamp(doc);

      expect(next.updatedAt).toBe(FIXED_NOW.toISOString());
    });
  });

  describe('scheduleAutoSave', () => {
    it('默认 3s 防抖：未到时间不落盘，到点落盘一次', async () => {
      const doc = makeDoc();
      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({ getDoc: () => doc, save });

      schedule();
      expect(save).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_DEBOUNCE_MS - 1);
      expect(save).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('连续调用只落盘一次（防抖合并）', async () => {
      const doc = makeDoc();
      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({ getDoc: () => doc, save });

      schedule();
      schedule();
      schedule();

      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_DEBOUNCE_MS);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('delayMs 可自定义', async () => {
      const doc = makeDoc();
      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({ getDoc: () => doc, save, delayMs: 50 });

      schedule();
      await vi.advanceTimersByTimeAsync(49);
      expect(save).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('getDoc 返回 null（无脏工程）时不落盘', async () => {
      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({ getDoc: () => null, save });

      schedule();
      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_DEBOUNCE_MS);

      expect(save).not.toHaveBeenCalled();
    });

    it('落盘失败时调用 onError，且不产生未捕获拒绝', async () => {
      const doc = makeDoc();
      const failure = new Error('QuotaExceededError');
      const onError = vi.fn();
      const save = makeSaveSpy(async () => {
        throw failure;
      });
      const schedule = scheduleAutoSave({ getDoc: () => doc, save, onError });

      schedule();
      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_DEBOUNCE_MS);

      expect(save).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('落盘时刷新 updatedAt 但保持 schemaVersion', async () => {
      const doc = makeDoc();
      const originalUpdatedAt = doc.updatedAt;
      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({ getDoc: () => doc, save });

      schedule();
      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_DEBOUNCE_MS);

      const saved = firstSavedDoc(save);
      // 落盘时刻的时钟（防抖触发瞬间）
      expect(saved.updatedAt).toBe(new Date(Date.now()).toISOString());
      // updatedAt 确实被刷新了
      expect(saved.updatedAt).not.toBe(originalUpdatedAt);
      // schemaVersion 不变（FR-005②：落盘不产生新版本号）
      expect(saved.schemaVersion).toBe('1.0.0');
      expect(saved.projectId).toBe('p-autosave');
    });

    it('pending：调度后为 true，落盘后为 false', async () => {
      const doc = makeDoc();
      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({ getDoc: () => doc, save });

      expect(schedule.pending).toBe(false);
      schedule();
      expect(schedule.pending).toBe(true);

      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_DEBOUNCE_MS);
      expect(schedule.pending).toBe(false);
    });

    it('cancel 后不再落盘', async () => {
      const doc = makeDoc();
      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({ getDoc: () => doc, save });

      schedule();
      expect(schedule.pending).toBe(true);

      schedule.cancel();
      expect(schedule.pending).toBe(false);

      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_DEBOUNCE_MS * 2);
      expect(save).not.toHaveBeenCalled();
    });

    it('flush 立即落盘（跳过防抖等待）', async () => {
      const doc = makeDoc();
      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({ getDoc: () => doc, save });

      schedule();
      schedule.flush();

      expect(save).toHaveBeenCalledTimes(1);
      expect(schedule.pending).toBe(false);
    });
  });

  describe('createAutoSaver', () => {
    it('flush 立即落盘，不等防抖', async () => {
      const doc = makeDoc();
      const save = makeSaveSpy();
      const saver = createAutoSaver({ getDoc: () => doc, save });

      await saver.flush();

      expect(save).toHaveBeenCalledTimes(1);
      const saved = firstSavedDoc(save);
      expect(saved.updatedAt).toBe(FIXED_NOW.toISOString());
      expect(saved.schemaVersion).toBe('1.0.0');
    });

    it('flush 时 getDoc 为 null 则不落盘', async () => {
      const save = makeSaveSpy();
      const saver = createAutoSaver({ getDoc: () => null, save });

      await saver.flush();

      expect(save).not.toHaveBeenCalled();
    });

    it('落盘失败时 onError 被调用，flush 不向外抛错', async () => {
      const doc = makeDoc();
      const failure = new Error('QuotaExceededError');
      const onError = vi.fn();
      const save = makeSaveSpy(async () => {
        throw failure;
      });
      const saver = createAutoSaver({ getDoc: () => doc, save, onError });

      await expect(saver.flush()).resolves.toBeUndefined();

      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('并发 flush 只落盘一次（running 锁）', async () => {
      const doc = makeDoc();
      const gate: { release: (() => void) | null } = { release: null };
      const save = makeSaveSpy(
        () =>
          new Promise<void>((resolve) => {
            gate.release = resolve;
          }),
      );
      const saver = createAutoSaver({ getDoc: () => doc, save });

      const first = saver.flush();
      const second = saver.flush();

      expect(save).toHaveBeenCalledTimes(1);

      gate.release?.();
      await Promise.all([first, second]);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('isPending 初始为 false（handle 未暴露调度入口）', () => {
      const doc = makeDoc();
      const saver = createAutoSaver({ getDoc: () => doc, save: async () => undefined });

      expect(saver.isPending()).toBe(false);
    });

    it('cancel 不会抛错，且不影响后续 flush', async () => {
      const doc = makeDoc();
      const save = makeSaveSpy();
      const saver = createAutoSaver({ getDoc: () => doc, save });

      expect(() => saver.cancel()).not.toThrow();

      await saver.flush();
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  describe('installBeforeUnloadFlush', () => {
    it('beforeunload 触发落盘', () => {
      const flush = vi.fn();
      installBeforeUnloadFlush(flush);

      window.dispatchEvent(new Event('beforeunload'));

      expect(flush).toHaveBeenCalledTimes(1);
    });

    it('visibilitychange 切到 hidden 时触发落盘', () => {
      const flush = vi.fn();
      installBeforeUnloadFlush(flush);

      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));

      expect(flush).toHaveBeenCalledTimes(1);
    });

    it('visibilitychange 仍可见时不触发落盘', () => {
      const flush = vi.fn();
      installBeforeUnloadFlush(flush);

      setVisibilityState('visible');
      document.dispatchEvent(new Event('visibilitychange'));

      expect(flush).not.toHaveBeenCalled();
    });

    it('卸载后不再响应任何事件', () => {
      const flush = vi.fn();
      const uninstall = installBeforeUnloadFlush(flush);

      uninstall();

      window.dispatchEvent(new Event('beforeunload'));
      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));

      expect(flush).not.toHaveBeenCalled();
    });

    it('flush 返回 Promise 时也能安全调用（不阻塞卸载流程）', () => {
      const flush = vi.fn(async () => undefined);
      installBeforeUnloadFlush(flush);

      expect(() => window.dispatchEvent(new Event('beforeunload'))).not.toThrow();
      expect(flush).toHaveBeenCalledTimes(1);
    });
  });

  describe('与 projectStore 的交互', () => {
    it('落盘的是 projectStore 当前工程的快照（updatedAt 被刷新）', async () => {
      const doc = makeDoc();
      useProjectStore.getState().setDoc(doc);

      const save = makeSaveSpy();
      const saver = createAutoSaver({
        getDoc: () => useProjectStore.getState().doc,
        save,
      });

      await saver.flush();

      expect(save).toHaveBeenCalledTimes(1);
      const saved = firstSavedDoc(save);
      expect(saved.projectId).toBe('p-autosave');
      expect(saved.updatedAt).toBe(FIXED_NOW.toISOString());
      expect(saved.schemaVersion).toBe('1.0.0');
    });

    it('工程内容变化后落盘的是新版本而非旧版本', async () => {
      const doc = makeDoc();
      useProjectStore.getState().setDoc(doc);

      const save = makeSaveSpy();
      const schedule = scheduleAutoSave({
        getDoc: () => useProjectStore.getState().doc,
        save,
      });

      schedule();
      const renamed = { ...useProjectStore.getState().doc, name: '改名后的工程' };
      useProjectStore.getState().setDoc(renamed);

      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_DEBOUNCE_MS);

      const saved = firstSavedDoc(save);
      expect(saved.name).toBe('改名后的工程');
    });
  });
});
