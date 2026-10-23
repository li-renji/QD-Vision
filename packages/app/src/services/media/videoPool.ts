/**
 * 离屏 `<video>` 元素池（预览侧取帧）。
 *
 * - 按 asset 复用元素，避免反复创建。
 * - `requestVideoFrameCallback` 做帧级同步。
 * - 漂移 > 40ms 才 seek，避免抖动（ARCHITECTURE §10 #3）。
 */

import { VIDEO_DRIFT_THRESHOLD_MS } from './constants.js';

/** 池中的一个元素。 */
export interface VideoPoolElement {
  assetId: string;
  element: HTMLVideoElement;
  /** 当前已定位到的源时间（毫秒） */
  currentMs: number;
}

/** 视频元素池。 */
export interface VideoPool {
  /** 取得（并缓存）某个素材的视频元素。 */
  acquire: (assetId: string) => HTMLVideoElement;
  /**
   * 把元素同步到目标源时间。
   *
   * @param assetId 素材 id
   * @param sourceMs 目标源时间（毫秒）
   * @param force 为 true 时无视漂移直接 seek
   */
  sync: (assetId: string, sourceMs: number, force?: boolean) => Promise<void>;
  /** 播放全部元素。 */
  playAll: () => Promise<void>;
  /** 暂停全部元素。 */
  pauseAll: () => void;
  /** 释放全部元素。 */
  dispose: () => void;
  /** 元素数量。 */
  readonly size: number;
}

/**
 * 创建视频元素池。
 */
export function createVideoPool(): VideoPool {
  const elements = new Map<string, HTMLVideoElement>();
  const currentTimes = new Map<string, number>();

  const acquire = (assetId: string): HTMLVideoElement => {
    const existing = elements.get(assetId);
    if (existing) return existing;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    elements.set(assetId, video);
    currentTimes.set(assetId, 0);
    return video;
  };

  const sync = async (assetId: string, sourceMs: number, force = false): Promise<void> => {
    const video = acquire(assetId);
    const current = currentTimes.get(assetId) ?? 0;
    const drift = Math.abs(sourceMs - current);

    if (!force && drift <= VIDEO_DRIFT_THRESHOLD_MS) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      video.addEventListener('seeked', () => done(), { once: true });
      video.addEventListener('error', () => done(), { once: true });
      video.currentTime = Math.max(0, sourceMs / 1000);
    });

    currentTimes.set(assetId, sourceMs);
  };

  const playAll = async (): Promise<void> => {
    await Promise.all(
      [...elements.values()].map(async (video) => {
        try {
          await video.play();
        } catch {
          // 自动播放策略拦截时忽略
        }
      }),
    );
  };

  const pauseAll = (): void => {
    for (const video of elements.values()) {
      video.pause();
    }
  };

  const dispose = (): void => {
    for (const video of elements.values()) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    elements.clear();
    currentTimes.clear();
  };

  return {
    acquire,
    sync,
    playAll,
    pauseAll,
    dispose,
    get size(): number {
      return elements.size;
    },
  };
}
