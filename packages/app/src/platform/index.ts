/**
 * 平台层统一出口。
 *
 * 业务层只应从 `platform/` 导入，**禁止**直接触碰 `window.*` 文件/存储 API。
 */

export type { PlatformBridge, PlatformCapabilities } from './PlatformBridge.js';
export { WebPlatformBridge } from './WebPlatformBridge.js';
export {
  AUDIO_CODEC_CANDIDATES,
  RECORDER_MIME_CANDIDATES,
  VIDEO_CODEC_CANDIDATES,
  detectCapabilities,
  getCapabilities,
  resetCapabilitiesCache,
} from './capabilities.js';
export {
  FILE_ACCEPT,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_EXTENSION_LIST,
  SUPPORTED_MIME_TYPES,
  detectAssetType,
  getExtension,
  isSupportedExtension,
  isSupportedMime,
  unsupportedReason,
} from './fileTypes.js';
export {
  PermissionDeniedError,
  PlatformError,
  UnsupportedOperationError,
} from './errors.js';

import { WebPlatformBridge } from './WebPlatformBridge.js';
import type { PlatformBridge } from './PlatformBridge.js';

let bridgeInstance: PlatformBridge | null = null;

/**
 * 获取平台桥单例。
 *
 * Electron 场景下可替换为 `ElectronPlatformBridge`（见下方占位）。
 */
export function getPlatformBridge(): PlatformBridge {
  if (!bridgeInstance) {
    bridgeInstance = new WebPlatformBridge();
  }
  return bridgeInstance;
}

/** 覆盖平台桥单例（测试或 Electron 壳层注入时使用）。 */
export function setPlatformBridge(bridge: PlatformBridge | null): void {
  bridgeInstance = bridge;
}

/**
 * Electron 平台桥（占位）。
 *
 * V1.0 **不实现**：Electron 套壳属于 P2（PRD §6 #18）。
 * 未来实现时需满足：
 * - `readFile` → `dialog.showOpenDialog`
 * - `saveFile` → `dialog.showSaveDialog` + `fs.writeFile`
 * - `storage` → `app.getPath('userData')` 下的 JSON 文件
 * - `getMediaDuration` → 复用 Web 实现（Electron 同样有 Chromium 媒体栈）
 * - `capability` → 复用 Web 实现 + 补充 Node 能力标记
 */
export interface ElectronPlatformBridge extends PlatformBridge {
  /** Electron 专属：用户数据目录。 */
  readonly userDataPath: string;
}
