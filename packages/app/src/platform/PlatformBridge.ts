/**
 * 平台能力接口（ARCHITECTURE §6.1）。
 *
 * **业务层只允许依赖此接口**，禁止直接调用 `window.*` 文件/存储 API。
 */

/** 运行时能力矩阵。 */
export interface PlatformCapabilities {
  /** File System Access API 是否可用 */
  fileSystemAccess: boolean;
  /** WebCodecs VideoEncoder/VideoDecoder 是否可用 */
  webCodecs: boolean;
  /** MediaRecorder 是否可用 */
  mediaRecorder: boolean;
  /** WebGPU 是否可用（端侧 AI） */
  webGpu: boolean;
  /** IndexedDB 是否可用 */
  indexedDb: boolean;
  /** VideoEncoder 支持的 codec 串（'avc1.640028' 等） */
  supportedVideoCodecs: string[];
  /** AudioEncoder 支持的 codec 串（'mp4a.40.2' / 'opus'） */
  supportedAudioCodecs: string[];
  /** MediaRecorder 支持的 mimeType */
  supportedRecorderMimeTypes: string[];
  /** 浏览器 UA 与版本 */
  userAgent: string;
  /** 是否为移动端（触控降级） */
  isMobile: boolean;
}

/** 平台桥接口。 */
export interface PlatformBridge {
  /** 读取本地文件（FS Access API 优先，降级 input[type=file]） */
  readFile(options?: { accept?: string[]; multiple?: boolean }): Promise<File[]>;
  /** 保存文件到本地（触发下载或写入用户选定目录） */
  saveFile(fileName: string, blob: Blob, options?: { mimeType?: string }): Promise<void>;
  /** 列目录（仅 File System Access API 可用时支持） */
  listFiles(directoryHandle?: FileSystemDirectoryHandle): Promise<File[]>;
  /** 键值存储（Electron 下映射到 userData/settings.json） */
  storage<T>(key: string, value: T | null): Promise<T | null>;
  /** 读取媒体时长（毫秒） */
  getMediaDuration(blob: Blob): Promise<number>;
  /** 能力探测 */
  capability(): Promise<PlatformCapabilities>;
}
