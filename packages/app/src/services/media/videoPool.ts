/**
 * 离屏 `<video>` 元素池（预览侧取帧 + **音频源**）。
 *
 * - 按 asset 复用元素，避免反复创建。
 * - `requestVideoFrameCallback` 做帧级同步。
 * - 漂移 > 40ms 才 seek，避免抖动（ARCHITECTURE §10 #3）。
 *
 * ## 为什么有 `muted` 这个开关（曾经「没有声音」的第一现场）
 *
 * 元素默认 `muted = true`：纯画面预览时，若多个 `<video>` 各自直连扬声器，
 * 会同时出声、互相叠加。
 *
 * 但接上 WebAudio 之后必须**解除静音** —— `HTMLMediaElement.muted` 是元素的
 * **输出闸门**，而不是「不直接出声」的开关：一旦 `createMediaElementSource(el)`
 * 建立，元素音频只能经由该 source node 输出，而 `muted = true` 会把
 * **整条链路（含 WebAudio 输出）一起掐断**。这正是「画面在动、就是没声音」
 * 最隐蔽的一个坑。
 *
 * 「多个元素不会各自出声」这件事由**拓扑**保证，而非 `muted`：
 * 元素音频全部被 `MediaElementAudioSourceNode` 接管，元素本身不连 destination，
 * 只有 `masterGain → context.destination` 一条出口（见 `previewAudio.ts`）。
 */

import { VIDEO_DRIFT_THRESHOLD_MS } from './constants.js';

/** 视频池中的元素。 */
export interface VideoPoolElement {
  assetId: string;
  element: HTMLVideoElement;
  /** 当前已定位到的源时间（毫秒） */
  currentMs: number;
}

/** 视频池创建参数。 */
export interface VideoPoolOptions {
  /**
   * 元素初始静音状态（默认 `true`）。
   *
   * `true` = 纯画面预览（历史行为）；接入 WebAudio 后由
   * {@link VideoPool.setMuted} 逐个解除。
   */
  muted?: boolean;
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
  /**
   * 设置元素静音状态（缺省作用于全部元素，且影响后续新建元素）。
   *
   * @param muted 目标静音状态
   * @param assetId 只作用于指定素材；缺省为全部
   */
  setMuted: (muted: boolean, assetId?: string) => void;
  /** 释放全部元素。 */
  dispose: () => void;
  /** 元素数量。 */
  readonly size: number;
  /** 当前处于静音状态的元素数量（诊断 / e2e 断言用）。 */
  readonly mutedCount: number;
}

/**
 * 创建视频元素池。
 */
export function createVideoPool(options: VideoPoolOptions = {}): VideoPool {
  const elements = new Map<string, HTMLVideoElement>();
  const currentTimes = new Map<string, number>();
  /** 全局静音状态：新元素按此初始化。 */
  let defaultMuted = options.muted ?? true;

  const acquire = (assetId: string): HTMLVideoElement => {
    const existing = elements.get(assetId);
    if (existing) return existing;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = defaultMuted;
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

  /**
   * 设置静音。
   *
   * ⚠️ 不传 `assetId` 时会改写全局默认值，**后续新建的元素**也按新值初始化 ——
   * 否则「先建元素、后接音频」的素材会永远保持旧状态。
   */
  const setMuted = (muted: boolean, assetId?: string): void => {
    if (assetId === undefined) {
      defaultMuted = muted;
      for (const video of elements.values()) {
        video.muted = muted;
      }
      return;
    }
    const video = elements.get(assetId);
    if (video) video.muted = muted;
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
    setMuted,
    dispose,
    get size(): number {
      return elements.size;
    },
    get mutedCount(): number {
      let count = 0;
      for (const video of elements.values()) {
        if (video.muted) count += 1;
      }
      return count;
    },
  };
}