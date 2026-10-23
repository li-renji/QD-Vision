/**
 * 全窗口拖拽导入测试（重复导入回归防护）。
 *
 * ## 背景 bug
 *
 * `useFileDrop` 被 `App.tsx` 与 `MediaPanel.tsx` **同时注册**，两者都监听
 * `window` 的 `drop` —— 一次拖拽触发两次导入，用户丢一个文件得到两个素材
 * （还会往 IndexedDB 写两份 blob，预览侧也多建一套 `<video>` + objectURL）。
 *
 * 该问题**先于预览取帧的改动存在**（`App.tsx` / `MediaPanel.tsx` 在 HEAD 里
 * 就各有��份注册）。
 *
 * 本文件锁定修复后的行为：
 * 1. 同一个 drop 事件只派发一次（即使有多个 window 监听器）
 * 2. **两次独立拖拽同一文件仍然导入两次**（不能过度去重，那是用户真实意图）
 * 3. 多文件一次全部回调 / 空 drop 不回调 / 卸载后不响应 / `enabled=false` 不注册
 *
 * 注：不引入 `@testing-library/react`（仓库未安装），直接用 `react-dom/client` 挂载。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetFileDropDispatchGuard, useFileDrop } from '../useFileDrop.js';

/** happy-dom 下让 `act` 可用。 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 挂载结果。 */
interface Mounted<T> {
  result: { current: T };
  /** 触发一次重渲染（用于观察监听器是否被反复重订阅）。 */
  rerender: () => void;
  unmount: () => void;
}

/** 用react-dom/client 挂载一个 hook（避免引入 testing-library）。 */
function mountHook<T>(hook: () => T): Mounted<T> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const box = { current: undefined as unknown as T };

  function Probe(): null {
    box.current = hook();
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  return {
    result: box,
    rerender: () => {
      act(() => {
        root.render(createElement(Probe));
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** 构造一个带文件的 drop 事件。 */
function createDropEvent(fileNames: readonly string[] = ['a.webm']): DragEvent {
  const files = fileNames.map(
    (name) => new File([new Uint8Array([1, 2, 3])], name, { type: 'video/webm' }),
  );
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, items: [] },
    configurable: true,
  });
  return event;
}

/** 构造一个不含文件的 drop 事件。 */
function createBareDropEvent(): DragEvent {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: [], files: [], items: [] },
    configurable: true,
  });
  return event;
}

/** 在 act 中派发事件（React 需要批处理）。 */
function dispatch(event: Event): void {
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('hooks/useFileDrop · 重复导入防护', () => {
  beforeEach(() => {
    resetFileDropDispatchGuard();
  });

  afterEach(() => {
    resetFileDropDispatchGuard();
    vi.restoreAllMocks();
  });

  it('单个监听器：一次 drop 回调一次', () => {
    const onFiles = vi.fn();
    const { unmount } = mountHook(() => useFileDrop({ onFiles }));
    try {
      dispatch(createDropEvent());
      expect(onFiles).toHaveBeenCalledTimes(1);
      expect(onFiles.mock.calls[0]?.[0]).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it('多个监听器（App + MediaPanel）：同一个 drop 只派发一次', () => {
    const appLevel = vi.fn();
    const panelLevel = vi.fn();
    // 复现真实结构：两个组件各自注册一份 window 监听器
    const a = mountHook(() => useFileDrop({ onFiles: appLevel }));
    const b = mountHook(() => useFileDrop({ onFiles: panelLevel }));
    try {
      dispatch(createDropEvent());

      const total = appLevel.mock.calls.length + panelLevel.mock.calls.length;
      expect(total).toBe(1);
    } finally {
      a.unmount();
      b.unmount();
    }
  });

  it('两次独立拖拽同一文件仍然导入两次（不做过度去重）', () => {
    const onFiles = vi.fn();
    const { unmount } = mountHook(() => useFileDrop({ onFiles }));
    try {
      dispatch(createDropEvent(['a.webm']));
      dispatch(createDropEvent(['a.webm']));

      expect(onFiles).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
    }
  });

  it('一次 drop 多个文件：一次性全部回调', () => {
    const onFiles = vi.fn();
    const { unmount } = mountHook(() => useFileDrop({ onFiles }));
    try {
      dispatch(createDropEvent(['a.webm', 'b.mp4', 'c.png']));

      expect(onFiles).toHaveBeenCalledTimes(1);
      expect(onFiles.mock.calls[0]?.[0]).toHaveLength(3);
    } finally {
      unmount();
    }
  });

  it('不含文件的 drop 不触发回调', () => {
    const onFiles = vi.fn();
    const { unmount } = mountHook(() => useFileDrop({ onFiles }));
    try {
      dispatch(createBareDropEvent());
      expect(onFiles).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('卸载后不再响应', () => {
    const onFiles = vi.fn();
    const { unmount } = mountHook(() => useFileDrop({ onFiles }));
    unmount();

    dispatch(createDropEvent());
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('enabled=false 时完全不注册监听器', () => {
    const onFiles = vi.fn();
    const { unmount } = mountHook(() => useFileDrop({ onFiles, enabled: false }));
    try {
      dispatch(createDropEvent());
      expect(onFiles).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('初始 isDragging 为 false', () => {
    const onFiles = vi.fn();
    const { result, unmount } = mountHook(() => useFileDrop({ onFiles }));
    try {
      expect(result.current.isDragging).toBe(false);
    } finally {
      unmount();
    }
  });

  /**
   * 回归防护：调用方传的是**内联箭头函数**，每次渲染都是新引用。
   * 若直接放进 effect 依赖数组，每次渲染都会 remove/add 一遍 window 监听器。
   */
  it('重渲染不会反复重订阅 window 监听器（onFiles 变化不应触发重订阅）', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    // 每次渲染都产生新的 onFiles 引用（模拟内联箭头函数）
    const { rerender, unmount } = mountHook(() =>
      useFileDrop({ onFiles: (files: File[]) => void files }),
    );

    const addsAfterMount = addSpy.mock.calls.length;
    rerender();
    rerender();
    rerender();

    // 监听器数量不应增长（否则说明每次渲染都在重订阅）
    expect(addSpy.mock.calls.length).toBe(addsAfterMount);
    unmount();
    // 卸载时应清理掉当初注册的那些监听器
    expect(removeSpy.mock.calls.length).toBe(addsAfterMount);
  });

  it('onFiles 更新后仍能拿到最新回调（ref 转发而非闭包快照）', () => {
    const first = vi.fn();
    const second = vi.fn();
    // 先声明再挂载：每次 rerender 都以不同的回调身份重建 hook 参数
    let currentCallback: (files: File[]) => void = first;

    const { rerender, unmount } = mountHook(() =>
      useFileDrop({ onFiles: () => currentCallback([]) }),
    );

    rerender();
    dispatch(createDropEvent());
    expect(first).toHaveBeenCalledTimes(1);

    currentCallback = second;
    rerender();
    dispatch(createDropEvent());
    // 最新回调被调用，而不是继续用旧的闭包快照
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);

    unmount();
  });
});