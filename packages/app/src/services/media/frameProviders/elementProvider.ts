/**
 * 降级取帧：`<video>` seek + `createImageBitmap`。
 *
 * 用于 WebM / 未知容器 / 无 WebCodecs 的环境。
 */

import type { Asset } from '@clipcut/shared-types';
import type { FrameProvider } from './types.js';

/** 视频元素池（按 asset 复用，避免反复创建元素）。 */
const elementPool = new Map<string, HTMLVideoElement>();

/** 取得（并缓存）某个素材的视频元素。 */
function getElement(assetId: string, url: string): HTMLVideoElement {
  const existing = elementPool.get(assetId);
  if (existing) return existing;
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  elementPool.set(assetId, video);
  return video;
}

/** 元素型帧提供器。 */
export class ElementFrameProvider implements FrameProvider {
  readonly kind = 'element' as const;

  /** 素材 id → blob URL。 */
  private readonly urls = new Map<string, string>();

  /**
   * 注册素材的 blob URL。
   */
  register(assetId: string, url: string): void {
    this.urls.set(assetId, url);
  }

  supports(asset: Asset): boolean {
    return asset.type === 'video' || asset.type === 'image';
  }

  async getFrameAt(assetId: string, sourceMs: number): Promise<ImageBitmap> {
    const url = this.urls.get(assetId);
    if (!url) {
      throw new Error(`未注册的素材：${assetId}`);
    }

    const video = getElement(assetId, url);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      if (video.readyState >= 1) {
        video.currentTime = Math.max(0, sourceMs / 1000);
        video.addEventListener('seeked', () => done(), { once: true });
        video.addEventListener('error', () => done(new Error('视频 seek 失败')), { once: true });
        return;
      }

      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.max(0, sourceMs / 1000);
      }, { once: true });
      video.addEventListener('seeked', () => done(), { once: true });
      video.addEventListener('error', () => done(new Error('视频加载失败')), { once: true });
    });

    return createImageBitmap(video);
  }

  dispose(): void {
    for (const video of elementPool.values()) {
      video.removeAttribute('src');
      video.load();
    }
    elementPool.clear();
    for (const url of this.urls.values()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }
}
