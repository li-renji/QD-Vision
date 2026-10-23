/**
 * 全窗口拖拽导入（`dragover` / `drop`），含拖拽遮罩态。
 */

import { useEffect, useState } from 'react';

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
 * 注册全窗口文件拖拽。
 */
export function useFileDrop(options: FileDropOptions): FileDropState {
  const { onFiles, enabled = true, preventDefault = true } = options;
  const [isDragging, setIsDragging] = useState(false);

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
      const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
      if (files.length > 0) onFiles(files);
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
  }, [enabled, onFiles, preventDefault]);

  return { isDragging };
}
