/**
 * 帧提供器接口（导出取帧底座）。
 */

import type { Asset } from '@clipcut/shared-types';

/**
 * 帧提供器。
 *
 * - `mp4-decoder`：mp4box 解封装 + `VideoDecoder` 硬解（主路径，帧精确）
 * - `element`：`<video>` seek + `createImageBitmap`（降级路径）
 */
export interface FrameProvider {
  /** 提供器类型。 */
  readonly kind: 'mp4-decoder' | 'element';
  /** 是否支持该素材。 */
  readonly supports: (asset: Asset) => boolean;
  /**
   * 取指定源时间的一帧。
   *
   * @param assetId 素材 id
   * @param sourceMs 源时间（毫秒）
   */
  getFrameAt(assetId: string, sourceMs: number): Promise<ImageBitmap>;
  /** 释放资源（关闭 decoder / 元素）。 */
  dispose(): void;
}
