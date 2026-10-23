/**
 * 预览取帧 —— **同步返回 + 异步更新缓存**。
 *
 * ## 为什么需要这一层
 *
 * `compositor.renderFrame` 是导出与预览共用的**唯一合成入口**，它的
 * {@link FrameGetter} 签名是**同步**的：
 *
 * ```ts
 * type FrameGetter = (assetId: string, sourceMs: number) => ImageBitmap | null;
 * ```
 *
 * 但从 `<video>` 取帧只能靠 `createImageBitmap(video)`，它是**异步**的
 * （返回 Promise）。二者无法直接对接 —— 这正是过去预览画布始终纯黑的根因：
 * `PreviewCanvas` 干脆不传 `getFrame`，`drawVideoClip` 直接 `return`。
 *
 * ## 本模块的做法（标准「帧缓存」模式）
 *
 * 1. **准备阶段（异步，不阻塞渲染）**：`assetId → blob（IndexedDB）→ objectURL
 *    → <video> / <img>`，全部在后台完成，元素按 assetId 复用（videoPool）。
 * 2. **取帧阶段（同步）**：`getFrame()` 只做三件极 cheap 的事：
 *    - 命中容差内的缓存 → 直接返回 `ImageBitmap`；
 *    - 未命中 → 记下目标源时间，**先返回最近一帧**（宁可显示略旧的帧也不要黑屏），
 *      同时异步触发一次抓帧；
 *    - 元素还没准备好 → 触发准备流程，返回 `null`（合成器跳过该图层，不影响其它图层）。
 * 3. **更新阶段（异步）**：`createImageBitmap` resolve 后写入缓存并通知
 *    `onFrameReady` 订阅者**立刻重绘一帧**，于是新画面马上出现。
 *
 * ## 播放 / 暂停 / 变速
 *
 * - **播放中**：`<video>` 自己播（`setPlaying(true)`），漂移 > 2×容差才纠正
 *   （避免每帧 seek 卡顿）。
 * - **暂停时**：按 `sourceMs` 精确定位（拖动播放头时立即生效）。
 * - **变速**：`video.playbackRate = rate`。
 *
 * ## 资源清理
 *
 * `dispose()` 会 `revokeObjectURL`、暂停并卸载所有 `<video>`、关闭所有
 * `ImageBitmap`，并 `videoPool.dispose()`。重复调用安全。
 *
 * ## 分层
 *
 * 素材字节**只**通过注入的 `readAssetBlob`（生产环境 = `blobRepo.getBlobByKey`）
 * 获取 —— 组件层与本模块都不直接触碰 `window.indexedDB`（ESLint 规则 A）。
 */

import type { Asset } from '@clipcut/shared-types';
import type { FrameGetter } from '../../render/compositor.js';
import { AV_SYNC_TOLERANCE_MS } from './constants.js';
import { createVideoPool, type VideoPool } from './videoPool.js';

/** 预览取帧器的可注入依赖（测试与降级用）。 */
export interface PreviewFrameSourceOptions {
  /**
   * 读取素材字节。
   *
   * 生产环境注入 `async (asset) => getBlobByKey(asset.blobKey ?? '')`；
   * 缺省时返回 `null`（无字节 → 该图层不绘制）。
   */
  readAssetBlob?: (asset: Asset) => Promise<Blob | null>;
  /** 创建 objectURL；缺省为 `URL.createObjectURL`。 */
  createObjectURL?: (blob: Blob) => string;
  /** 释放 objectURL；缺省为 `URL.revokeObjectURL`。 */
  revokeObjectURL?: (url: string) => void;
  /** 抓帧；缺省为 `createImageBitmap`。 */
  captureFrame?: (source: HTMLVideoElement | HTMLImageElement) => Promise<ImageBitmap>;
  /** 视频池工厂；缺省为 {@link createVideoPool}。 */
  createPool?: () => VideoPool;
  /**
   * 图片元素工厂；缺省为 `document.createElement('img')`。
   *
   * 视频走 `videoPool`（可注入），图片同样提供注入点 —— 否则图片路径无法在
   * 测试中替换，且与视频路径的处理方式不一致。
   */
  createImageElement?: () => HTMLImageElement;
}

/** 预览取帧器。 */
export interface PreviewFrameSource {
  /**
   * 登记素材并异步准备其媒体元素（幂等）。
   *
   * 渲染层持有 `doc.assets`，在工程 / 素材变化时调用；
   * 之后 {@link PreviewFrameSource.getFrame} 才能按 `assetId` 找到字节与类型。
   */
  ensureAsset: (asset: Asset) => Promise<boolean>;
  /** 同步取帧 —— 签名与 `compositor.FrameGetter` 完全一致。 */
  getFrame: FrameGetter;
  /** 把某素材显式定位到 `sourceMs` 并抓一帧（首次 seek / 拖动播放头后调用）。 */
  prime: (assetId: string, sourceMs: number) => Promise<void>;
  /** 播放状态变化：播放 / 暂停所有已就绪的视频元素。 */
  setPlaying: (playing: boolean) => void;
  /**
   * 取得某素材对应的媒体元素（音频接线用）。
   *
   * **音频必须复用这里已建好的 `<video>` 元素** —— 不能另建一个：
   * ① 同一素材只应存在一个解码实例；
   * ② `createMediaElementSource` 对同一元素只能调用一次，而
   *   `AudioEngine` 用 `WeakMap` 按元素缓存 source node，两边指向同一个元素
   *   才能复用缓存。
   *
   * 未就绪 / 未登记 / 图片素材（`<img>` 无音频）返回 `null`，
   * 调用方据此安全降级（该 clip 不进混音图）。
   */
  getElement: (assetId: string) => HTMLMediaElement | null;
  /**
   * 解除某素材元素的 `muted`（接入 WebAudio 后必须调用）。
   *
   * ⚠️ `HTMLMediaElement.muted` 是元素输出的闸门，不只是「不直接出声」：
   * `muted = true` 会把 `MediaElementAudioSourceNode` 的输出**一起掐断**。
   * 见 `videoPool.setMuted` 的说明。
   */
  unmute: (assetId: string) => void;
  /** 播放倍速变化（同步到 `video.playbackRate`）。 */
  setPlaybackRate: (rate: number) => void;
  /**
   * 设置某素材的片段倍速（`clip.speed`）。
   *
   * 实际 `playbackRate` = 全局倍速 × 本倍速。
   * 同一素材被多个不同 speed 的 clip 引用时后写入者胜 —— 由调用方按播放头
   * 选出当前应生效的 clip，见 `previewAudio.resolveAssetSpeeds`。
   */
  setAssetSpeed: (assetId: string, speed: number) => void;
  /** 订阅「异步帧已就绪」通知；返回取消订阅函数。 */
  onFrameReady: (listener: () => void) => () => void;
  /**
   * 订阅「媒体元素首次就绪」通知；返回取消订阅函数。
   *
   * **音频接线的存在理由**：混音图必须拿到**已就绪**的元素才能建
   * `MediaElementAudioSourceNode`，而工程刚打开时元素还在异步
   * `blob → objectURL → loadeddata`。没有这个订阅，就只能等下一次
   * 工程变化才建图 —— 用户会听到「改了东西之后突然有声音」。
   *
   * 每个素材只触发一次（不是每帧），因此订阅方可以直接重建混音图。
   */
  onElementReady: (listener: (assetId: string) => void) => () => void;
  /** 已登记的素材数量（测试断言用）。 */
  readonly assetCount: number;
  /**
   * 已登记的素材 id 列表（诊断 / e2e 用）。
   *
   * 元素是游离的（不在 DOM 里），外部要枚举它们只能从这里拿 id。
   */
  getAssetIds: () => string[];
  /** 已就绪（可取帧）的素材数量（测试断言用）。 */
  readonly readyCount: number;
  /** 释放全部资源（重复调用安全）。 */
  dispose: () => void;
}

/** 单个素材的运行时状态。 */
interface AssetRuntime {
  assetId: string;
  asset: Asset;
  /** objectURL（需在 dispose 时 revoke）。 */
  url: string | null;
  /** `<video>`（视频素材）。 */
  video: HTMLVideoElement | null;
  /** `<img>`（图片素材）。 */
  image: HTMLImageElement | null;
  /** 元素是否已加载到可以取帧的程度。 */
  ready: boolean;
  /** 最近一次成功抓取的帧。 */
  bitmap: ImageBitmap | null;
  /** 最近一帧对应的**源时间**（毫秒）。 */
  bitmapMs: number;
  /** 正在进行的抓帧 promise（去重用）。 */
  pending: Promise<void> | null;
  /** 该元素的播放意图。 */
  playing: boolean;
}

/** 默认的异步抓帧实现。 */
async function defaultCaptureFrame(
  source: HTMLVideoElement | HTMLImageElement,
): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('当前环境不支持 createImageBitmap，无法抓取预览帧');
  }
  return createImageBitmap(source);
}

/** 是否为视频元素（避免依赖 `instanceof`，便于测试注入假元素）。 */
function isVideoElement(element: HTMLVideoElement | HTMLImageElement): element is HTMLVideoElement {
  return 'readyState' in element;
}

/**
 * 创建预览取帧器。
 *
 * @param options 依赖注入（全部可选）
 */
export function createPreviewFrameSource(
  options: PreviewFrameSourceOptions = {},
): PreviewFrameSource {
  const readAssetBlob = options.readAssetBlob ?? (async (): Promise<Blob | null> => null);
  const createObjectURL =
    options.createObjectURL ?? ((blob: Blob): string => URL.createObjectURL(blob));
  const revokeObjectURL =
    options.revokeObjectURL ?? ((url: string): void => URL.revokeObjectURL(url));
  const captureFrame = options.captureFrame ?? defaultCaptureFrame;
  const createImageElement =
    options.createImageElement ?? ((): HTMLImageElement => document.createElement('img'));
  const pool = (options.createPool ?? createVideoPool)();

  /** assetId → 运行时状态。 */
  const runtimes = new Map<string, AssetRuntime>();
  /** assetId → 正在进行的准备 promise（去重用）。 */
  const preparing = new Map<string, Promise<boolean>>();
  /** 帧就绪监听器。 */
  const frameReadyListeners = new Set<() => void>();
  /** 元素首次就绪监听器。 */
  const elementReadyListeners = new Set<(assetId: string) => void>();
  /** 已经通知过「元素就绪」的素材（保证每个素材只触发一次）。 */
  const announcedReady = new Set<string>();
  /** 已释放标记：置位后所有异步回调都必须停止写缓存。 */
  let disposed = false;
  /** 全局播放倍速（J/K/L 穿梭控制），默认 1。 */
  let globalRate = 1;
  /** assetId → 片段倍速（clip.speed）。 */
  const assetSpeeds = new Map<string, number>();

  const notifyFrameReady = (): void => {
    for (const listener of frameReadyListeners) listener();
  };

  /**
   * 元素首次就绪时通知外部（音频据此重建混音图）。
   *
   * 只在**由未就绪转为就绪**的那一刻触发一次；图片素材也会触发，
   * 由调用方自行判断（图片没有音频元素，`getElement` 会返回 null）。
   */
  const announceElementReady = (runtime: AssetRuntime): void => {
    if (!runtime.ready || announcedReady.has(runtime.assetId)) return;
    announcedReady.add(runtime.assetId);
    for (const listener of elementReadyListeners) listener(runtime.assetId);
  };

  /** 取得（或创建）某素材的运行时状态。 */
  const runtimeOf = (asset: Asset): AssetRuntime => {
    const existing = runtimes.get(asset.id);
    if (existing) {
      // 素材元数据可能被更新（如 relink 换了 blobKey），同步最新引用
      existing.asset = asset;
      return existing;
    }
    const created: AssetRuntime = {
      assetId: asset.id,
      asset,
      url: null,
      video: null,
      image: null,
      ready: false,
      bitmap: null,
      bitmapMs: 0,
      pending: null,
      playing: false,
    };
    runtimes.set(asset.id, created);
    return created;
  };

  /** 等待元素可以取帧（视频 `loadeddata` / 图片 `load`）。 */
  const waitReady = (element: HTMLVideoElement | HTMLImageElement): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (isVideoElement(element)) {
        if (element.readyState >= 2) {
          resolve(true);
          return;
        }
      } else if (element.complete && element.naturalWidth > 0) {
        resolve(true);
        return;
      }
      const onLoad = (): void => resolve(true);
      const onError = (): void => resolve(false);
      element.addEventListener('loadeddata', onLoad, { once: true });
      element.addEventListener('load', onLoad, { once: true });
      element.addEventListener('error', onError, { once: true });
    });

  /** 准备某素材的媒体元素：blob → objectURL → 元素 `src`（只做一次）。 */
  const prepare = async (runtime: AssetRuntime): Promise<boolean> => {
    if (disposed) return false;
    if (runtime.ready) return true;

    // objectURL 已建 → 只差 ready 事件
    if (runtime.url !== null) {
      const existing = runtime.video ?? runtime.image;
      if (existing) runtime.ready = await waitReady(existing);
      announceElementReady(runtime);
      return runtime.ready;
    }

    const blob = await readAssetBlob(runtime.asset);
    if (disposed || !blob) return false;

    const url = createObjectURL(blob);
    if (disposed) {
      revokeObjectURL(url);
      return false;
    }
    runtime.url = url;

    if (runtime.asset.type === 'image') {
      const image = createImageElement();
      runtime.image = image;
      image.src = url;
    } else {
      // 走池化：同一 assetId 复用同一 `<video>` 元素
      const video = pool.acquire(runtime.assetId);
      runtime.video = video;
      video.src = url;
    }

    const element = runtime.video ?? runtime.image;
    if (!element) return false;
    runtime.ready = await waitReady(element);
    announceElementReady(runtime);
    if (runtime.ready) notifyFrameReady();
    return runtime.ready;
  };

  /** 启动一次准备流程（同素材并发调用共享同一个 promise）。 */
  const prepareOnce = (assetId: string): Promise<boolean> => {
    const existing = preparing.get(assetId);
    if (existing) return existing;
    const runtime = runtimes.get(assetId);
    if (!runtime) return Promise.resolve(false);
    const task = prepare(runtime).finally(() => {
      preparing.delete(assetId);
    });
    preparing.set(assetId, task);
    return task;
  };

  /**
   * 抓取一帧并写入缓存。
   *
   * 同一素材的并发请求被 `pending` 去重成一次抓帧。
   */
  const capture = (runtime: AssetRuntime, sourceMs: number): Promise<void> => {
    if (disposed || runtime.pending) return runtime.pending ?? Promise.resolve();

    const element = runtime.video ?? runtime.image;
    if (!element || !runtime.ready) return Promise.resolve();

    const task = (async (): Promise<void> => {
      try {
        // 暂停态：先精确定位到目标源时间再抓帧（拖动播放头时立即生效）
        if (runtime.video && !runtime.playing) {
          const driftMs = Math.abs(runtime.video.currentTime * 1000 - sourceMs);
          if (driftMs > AV_SYNC_TOLERANCE_MS) {
            runtime.video.currentTime = Math.max(0, sourceMs / 1000);
          }
        }
        const bitmap = await captureFrame(element);
        if (disposed) {
          bitmap.close?.();
          return;
        }
        runtime.bitmap?.close?.();
        runtime.bitmap = bitmap;
        runtime.bitmapMs = sourceMs;
        notifyFrameReady();
      } catch {
        // 抓帧失败（元素未就绪 / 解码错误）：保留上一帧，绝不把异常抛进渲染路径
      } finally {
        runtime.pending = null;
      }
    })();

    runtime.pending = task;
    return task;
  };

  const ensureAsset = (asset: Asset): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    runtimeOf(asset);
    return prepareOnce(asset.id);
  };

  /**
   * 同步取帧。
   *
   * - 容差内命中缓存 → 直接返回（零开销）；
   * - 未命中 → 触发异步抓帧，**先返回最近一帧**（避免黑屏）；
   * - 未就绪 → 触发准备流程，返回 `null`。
   */
  const getFrame: FrameGetter = (assetId, sourceMs) => {
    if (disposed) return null;
    const runtime = runtimes.get(assetId);
    if (!runtime) return null;

    if (!runtime.ready) {
      void prepareOnce(assetId);
      return runtime.bitmap;
    }

    // 缓存足够新 → 直接返回
    if (runtime.bitmap && Math.abs(runtime.bitmapMs - sourceMs) <= AV_SYNC_TOLERANCE_MS) {
      return runtime.bitmap;
    }

    // 播放态：视频元素自己在播，只在漂移超阈值时纠正（每帧 seek 会卡顿）
    if (runtime.video && runtime.playing) {
      const driftMs = Math.abs(runtime.video.currentTime * 1000 - sourceMs);
      if (driftMs > AV_SYNC_TOLERANCE_MS * 2) {
        runtime.video.currentTime = Math.max(0, sourceMs / 1000);
      }
    }

    void capture(runtime, sourceMs);
    // 关键：先返回上一帧，让画面「有内容」，新帧到位后再重绘
    return runtime.bitmap;
  };

  /** 把某素材显式定位到 `sourceMs` 并抓一帧。 */
  const prime = async (assetId: string, sourceMs: number): Promise<void> => {
    const runtime = runtimes.get(assetId);
    if (!runtime) return;
    const ready = await prepareOnce(assetId);
    if (!ready || disposed) return;
    if (runtime.video) {
      runtime.video.currentTime = Math.max(0, sourceMs / 1000);
    }
    await capture(runtime, sourceMs);
  };

  const setPlaying = (playing: boolean): void => {
    if (disposed) return;
    for (const runtime of runtimes.values()) {
      const video = runtime.video;
      if (!video || !runtime.ready) continue;
      runtime.playing = playing;
      if (playing) {
        void video.play().catch(() => {
          // 自动播放策略拦截：降级为「靠时钟推进 + 每帧纠正漂移」
          runtime.playing = false;
        });
      } else {
        video.pause();
      }
    }
  };

  /**
   * 取得某素材的媒体元素。
   *
   * 只在 `runtime.ready` 之后返回：未就绪时 `src` 可能还没挂上，
   * 此时建 source node 会得到一个永远不出声的节点。
   */
  const getElement = (assetId: string): HTMLMediaElement | null => {
    const runtime = runtimes.get(assetId);
    if (!runtime || !runtime.ready) return null;
    // `<img>` 不是 HTMLMediaElement —— 图片素材天然无音频，返回 null。
    return runtime.video;
  };

  /**
   * 解除某素材元素的静音（接入 WebAudio 后必须调用）。
   *
   * 走 `pool.setMuted(false, assetId)` 而不是直接改 `element.muted`：
   * 池是元素的唯一持有者，改它才能让「重建图后再次静音/解除」保持一致。
   */
  const unmute = (assetId: string): void => {
    pool.setMuted(false, assetId);
  };

  const setPlaybackRate = (rate: number): void => {
    if (disposed) return;
    globalRate = rate;
    for (const runtime of runtimes.values()) {
      if (runtime.video) runtime.video.playbackRate = globalRate * (assetSpeeds.get(runtime.assetId) ?? 1);
    }
  };

  /**
   * 设置某素材的**片段倍速**（`clip.speed`）。
   *
   * 元素的实际 `playbackRate` = {@link setPlaybackRate} 的全局倍速 × 本倍速。
   * 二者必须相乘而不是覆盖：全局倍速来自 J/K/L 穿梭控制，片段倍速来自
   * 时间线上每个 clip 自己的 `speed`，两者是**不同的维度**。
   *
   * ⚠️ 同一个素材可能被多个不同 `speed` 的 clip 引用（元素按 asset 池化），
   * 此时**后写入者胜** —— 由调用方（`previewAudio`）按播放头选出当前应生效
   * 的那一个 clip，见 `resolveAssetSpeeds`。多 clip 同时重叠出声时仍会有偏差，
   * 这是池化设计的已知取舍。
   */
  const setAssetSpeed = (assetId: string, speed: number): void => {
    if (disposed) return;
    if (assetSpeeds.get(assetId) === speed) return;
    assetSpeeds.set(assetId, speed);
    const runtime = runtimes.get(assetId);
    if (runtime?.video) runtime.video.playbackRate = globalRate * speed;
  };

  const onFrameReady = (listener: () => void): (() => void) => {
    frameReadyListeners.add(listener);
    return () => {
      frameReadyListeners.delete(listener);
    };
  };

  const onElementReady = (listener: (assetId: string) => void): (() => void) => {
    elementReadyListeners.add(listener);
    return () => {
      elementReadyListeners.delete(listener);
    };
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const runtime of runtimes.values()) {
      runtime.bitmap?.close?.();
      runtime.bitmap = null;
      if (runtime.video) {
        runtime.video.pause();
        runtime.video.removeAttribute('src');
        runtime.video.load();
      }
      runtime.image?.removeAttribute('src');
      if (runtime.url !== null) {
        revokeObjectURL(runtime.url);
        runtime.url = null;
      }
    }
    runtimes.clear();
    preparing.clear();
    assetSpeeds.clear();
    announcedReady.clear();
    frameReadyListeners.clear();
    elementReadyListeners.clear();
    pool.dispose();
  };

  return {
    ensureAsset,
    getFrame,
    prime,
    setPlaying,
    getElement,
    unmute,
    setPlaybackRate,
    setAssetSpeed,
    onFrameReady,
    onElementReady,
    get assetCount(): number {
      return runtimes.size;
    },
    getAssetIds: (): string[] => [...runtimes.keys()],
    get readyCount(): number {
      let count = 0;
      for (const runtime of runtimes.values()) {
        if (runtime.ready) count += 1;
      }
      return count;
    },
    dispose,
  };
}