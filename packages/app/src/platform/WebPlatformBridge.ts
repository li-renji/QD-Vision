/**
 * Web 平台实现（ARCHITECTURE §6.1）。
 *
 * 本文件位于 `platform/` 白名单目录，允许直接访问 `window.showOpenFilePicker`
 * 与 `localStorage`——这正是「业务层零直接调用」约束的**唯一出口**。
 */

import type { PlatformBridge, PlatformCapabilities } from './PlatformBridge.js';
import { getCapabilities } from './capabilities.js';
import { PermissionDeniedError, UnsupportedOperationError } from './errors.js';

/** `showOpenFilePicker` 的最小结构化类型。 */
interface FilePickerWindow {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
}

/** localStorage 键前缀（隔离 ClipCut 的键空间）。 */
const STORAGE_KEY_PREFIX = 'clipcut:';

/** 目录递归最大深度。 */
const MAX_DIRECTORY_DEPTH = 2;

function pickerWindow(): FilePickerWindow {
  return window as unknown as FilePickerWindow;
}

/** 判断异常是否表示用户取消/拒绝。 */
function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'NotAllowedError';
}

/** Web 平台的 `PlatformBridge` 实现。 */
export class WebPlatformBridge implements PlatformBridge {
  /**
   * 读取本地文件。
   *
   * 优先使用 File System Access API；不可用时降级为隐藏的 `<input type="file">`。
   */
  async readFile(options?: { accept?: string[]; multiple?: boolean }): Promise<File[]> {
    const multiple = options?.multiple ?? true;
    const accept = options?.accept;

    const picker = pickerWindow().showOpenFilePicker;
    if (typeof picker === 'function') {
      try {
        const options: {
          multiple?: boolean;
          types?: Array<{ description: string; accept: Record<string, string[]> }>;
        } = { multiple };
        if (accept && accept.length > 0) {
          options.types = [
            {
              description: '媒体文件',
              accept: { 'application/octet-stream': accept },
            },
          ];
        }
        const handles = await picker.call(window, options);
        const files: File[] = [];
        for (const handle of handles) {
          files.push(await (await handle.getFile()));
        }
        return files;
      } catch (error) {
        if (isAbortError(error)) {
          throw new PermissionDeniedError('用户取消了文件选择。', { cause: error });
        }
        // FS Access API 失败时继续尝试降级路径。
      }
    }

    return this.readFileViaInput(accept, multiple);
  }

  /** 降级路径：构造隐藏 `<input type="file">`。 */
  private readFileViaInput(accept: string[] | undefined, multiple: boolean): Promise<File[]> {
    return new Promise<File[]>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = multiple;
      input.style.display = 'none';
      if (accept && accept.length > 0) input.accept = accept.join(',');

      const cleanup = (): void => {
        input.remove();
      };

      input.addEventListener('change', () => {
        const files = input.files ? Array.from(input.files) : [];
        cleanup();
        resolve(files);
      });
      input.addEventListener('cancel', () => {
        cleanup();
        reject(new PermissionDeniedError('用户取消了文件选择。'));
      });

      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * 保存文件到本地。
   *
   * 优先 `showSaveFilePicker` 写入用户选定位置；否则降级为 Blob 下载。
   */
  async saveFile(fileName: string, blob: Blob, options?: { mimeType?: string }): Promise<void> {
    const saver = pickerWindow().showSaveFilePicker;
    if (typeof saver === 'function') {
      try {
        const handle = await saver.call(window, { suggestedName: fileName });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        if (isAbortError(error)) {
          throw new PermissionDeniedError('用户取消了保存。', { cause: error });
        }
        // 写盘失败时降级为下载。
      }
    }

    this.downloadBlob(fileName, blob, options?.mimeType);
  }

  /** 触发浏览器下载并及时释放 ObjectURL。 */
  private downloadBlob(fileName: string, blob: Blob, mimeType?: string): void {
    const url = URL.createObjectURL(mimeType ? new Blob([blob], { type: mimeType }) : blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 延迟释放，避免部分浏览器下载尚未开始就失效。
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /**
   * 列目录。
   *
   * 仅在 File System Access API 可用时支持；递归深度上限 2。
   */
  async listFiles(directoryHandle?: FileSystemDirectoryHandle): Promise<File[]> {
    const picker = pickerWindow().showDirectoryPicker;
    if (typeof picker !== 'function') {
      throw new UnsupportedOperationError('当前浏览器不支持 File System Access API，无法列目录。');
    }

    let handle = directoryHandle;
    if (!handle) {
      try {
        handle = await picker.call(window, { mode: 'read' });
      } catch (error) {
        if (isAbortError(error)) {
          throw new PermissionDeniedError('用户取消了目录选择。', { cause: error });
        }
        throw new UnsupportedOperationError('无法打开目录。', { cause: error });
      }
    }

    return this.collectFiles(handle, 0);
  }

  /** 递归收集目录下的文件。 */
  private async collectFiles(handle: FileSystemDirectoryHandle, depth: number): Promise<File[]> {
    const files: File[] = [];
    const iterable = handle as unknown as {
      values(): AsyncIterableIterator<FileSystemHandle>;
    };

    for await (const entry of iterable.values()) {
      if (entry.kind === 'file') {
        const fileHandle = entry as FileSystemFileHandle;
        files.push(await fileHandle.getFile());
      } else if (depth < MAX_DIRECTORY_DEPTH) {
        const dirHandle = entry as FileSystemDirectoryHandle;
        files.push(...(await this.collectFiles(dirHandle, depth + 1)));
      }
    }
    return files;
  }

  /**
   * 键值存储。
   *
   * 使用 `localStorage` 的隔离实现（`clipcut:` 前缀 + JSON 序列化）。
   * 注意：这里**只允许存放元数据**，素材二进制一律走 IndexedDB。
   */
  async storage<T>(key: string, value: T | null): Promise<T | null> {
    const fullKey = `${STORAGE_KEY_PREFIX}${key}`;
    if (value === null) {
      window.localStorage.removeItem(fullKey);
      return null;
    }
    window.localStorage.setItem(fullKey, JSON.stringify(value));
    return value;
  }

  /** 读取媒体时长（毫秒）；失败时返回 0。 */
  async getMediaDuration(blob: Blob): Promise<number> {
    const url = URL.createObjectURL(blob);
    try {
      const duration = await new Promise<number>((resolve) => {
        const element = document.createElement('video');
        element.preload = 'metadata';
        element.muted = true;

        const finish = (value: number): void => {
          element.removeAttribute('src');
          element.load();
          resolve(value);
        };

        element.addEventListener('loadedmetadata', () => {
          const raw = element.duration;
          finish(Number.isFinite(raw) ? Math.round(raw * 1000) : 0);
        });
        element.addEventListener('error', () => {
          finish(0);
        });
        element.src = url;
      });
      return duration;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** 能力探测（带缓存）。 */
  async capability(): Promise<PlatformCapabilities> {
    return getCapabilities();
  }
}
