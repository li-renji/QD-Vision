/**
 * 全窗口拖拽导入（`dragover` / `drop`），含拖拽遮罩态。
 *
 * ## 为什么要做「每次 drop 只派发一次」
 *
 * 本hook 会被**多个组件同时注册**：`App.tsx`（全局导入 + toast）与
 * `MediaPanel.tsx`（素材库导入）各注册一份，而两者都监听 `window` 的 `drop`。
 * 结果是**一次拖拽 = 两次导入** —— 用户丢一个文件，素材库里出现两个素材
 * （各自还会往IndexedDB 写一份blob，白占空间）。
 *
 * 该问题**先于本次改动存在**（`App.tsx` / `MediaPanel.tsx` 在 HEAD 里就各有
 * 一份注册），但它会直接影响预览取帧：素材重复 → 视频元素与objectURL 翻倍。
 *
 * 修复方式：模块内记录**最近一次已派发的 drop**，同一事件循环回合内的后续
 * 监听器直接跳过。用「事件对象身份 + 时间戳」而非「文件签名」去重，
 * 因此**两次独立拖拽同一文件仍会正常导入两次**（那是用户的真实意图）。
 */

import { useEffect, useRef, useState } from 'react';

/** 拖拽导入参数。 */
export interface FileDropOptions {
  /** 拖入文件后的回调。 */
  onFiles: (files: File[]) => void;
  /** 是否启用。 */
  enabled?: boolean;
  /** 拖拽时是否阻止浏览器默认行为。 */
  preventDefault?: boolean;
}

/** 拖拽导入返回值。 */
export interface FileDropState {
  /** 是否正在拖拽文件到窗口上。 */
  isDragging: boolean;
}

/**
 * 最近一次已派发的 drop。
 *
 * 同一事件会被多个 `window` 监听器看到，用事件对象身份即可精确识别
 * 「同一个 drop」，无需依赖文件内容或时间窗口。
 */
let lastDispatchedDrop: Event | null = null;

/** 仅供测试重置模块级去重状态。 */
export function resetFileDropDispatchGuard(): void {
  lastDispatchedDrop = null;
}

/**
 * 注册全窗口文件拖拽。
 *
 * ## 为什么用 ref 持有 `onFiles`
 *
 * 调用方（`App.tsx` / `MediaPanel.tsx`）传的都是**内联箭头函数**，每次渲染都是
 * 新引用。若把它放进 effect 依赖数组，effect 就会**每次渲染**都执行
 * `removeEventListener` + `addEventListener` —— 组件渲染越频繁、抖动越明显。
 *
 * 因此这里用 ref 持有**最新**回调并从依赖数组里移除 `onFiles`：
 * 监听器只在 `enabled` / `preventDefault` 变化时重订阅，回调更新零成本。
 */
export function useFileDrop(options: FileDropOptions): FileDropState {
  const { onFiles, enabled = true, preventDefault = true } = options;
  const [isDragging, setIsDragging] = useState(false);

  // 始终指向最新的 onFiles，但不参与 effect 依赖（避免反复重订阅监听器）
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    if (!enabled) return;

    let depth = 0;

    const hasFiles = (event: DragEvent): boolean =>
      event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes('Files');

    const onDragEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      if (preventDefault) event.preventDefault();
      depth += 1;
      setIsDragging(true);
    };

    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      if (preventDefault) event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };

    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      if (preventDefault) event.preventDefault();
      depth = 0;
      setIsDragging(false);

      // 同一个 drop 只派发一次（详见文件头「为什么要做每次 drop 只派发一次」）
      if (lastDispatchedDrop === event) return;
      lastDispatchedDrop = event;

      const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
      if (files.length > 0) onFilesRef.current(files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [enabled, preventDefault]);

  return { isDragging };
}