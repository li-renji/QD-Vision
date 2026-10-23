/**
 * 预览取帧缓存测试（预览画布全黑的根因修复）。
 *
 * ## 为什么这些测试能真正失败
 *
 * 过去 `PreviewCanvas` 干脆不传 `getFrame`，`compositor.drawVideoClip` 在
 * `if (!getFrame) return;` 处返回 —— 视频图层永不绘制。本文件用**可观测的假元素**
 * 验证「同步 `getFrame` 能拿到异步抓来的帧」，以及清理、播放/暂停、变速等行为。
 *
 * 关键用例「异步取帧完成后同步调用能拿到缓存帧」正是对根因的直接回归防护：
 * 把`capture` 里的 `runtime.bitmap = bitmap` 删掉，该用例会立刻变红。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@clipcut/shared-types';
import { AV_SYNC_TOLERANCE_MS } from '../constants.js';
import { createPreviewFrameSource } from '../previewFrameSource.js';
import type { PreviewFrameSource } from '../previewFrameSource.js';

/** 可观测的假 `<video>`。 */
class FakeVideoElement extends EventTarget {
  src = '';
  currentTime = 0;
  readyState = 4;
  playbackRate = 1;
  muted = true;
  playsInline = true;
  preload = '';
  paused = true;
  /** play() 调用次数。 */
  playCount = 0;
  /** pause() 调用次数。 */
  pauseCount = 0;
  /** 模拟浏览器解码就绪。 */
  markLoaded(): void {
    this.readyState = 4;
    this.dispatchEvent(new Event('loadeddata'));
  }

  play(): Promise<void> {
    this.playCount += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCount += 1;
    this.paused = true;
  }

  load(): void {
    /* no-op */
  }

  removeAttribute(): void {
    /* no-op */
  }
}

/** 可观测的假 `<img>`。 */
class FakeImageElement extends EventTarget {
  src = '';
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;

  markLoaded(): void {
    this.complete = true;
    this.naturalWidth = 1920;
    this.naturalHeight = 1080;
    this.dispatchEvent(new Event('load'));
  }

  removeAttribute(): void {
    /* no-op */
  }
}

/** 假ImageBitmap。 */
function createFakeBitmap(label: string, width = 1920, height = 1080): ImageBitmap {
  return {
    label,
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

/** 测试夹具。 */
interface Fixture {
  source: PreviewFrameSource;
  videos: FakeVideoElement[];
  images: FakeImageElement[];
  /** 抓帧调用记录（顺序 = 调用顺序）。 */
  captures: Array<{ kind: 'video' | 'image'; sourceMs: number }>;
  /** 已 revoke 的 objectURL。 */
  revoked: string[];
  /** 已创建的 objectURL → 素材 id。 */
  urls: Map<string, string>;
  /** 手动 resolve 挂起的抓帧 promise。 */
  pendingCaptures: Array<() => void>;
  /** 让下一次挂起的抓帧以 reject 收场。 */
  rejectedCaptures: number;
}

/** 构造一个视频素材。 */
function makeVideoAsset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    type: 'video',
    name: `${id}.mp4`,
    sourceType: 'local',
    mimeType: 'video/mp4',
    sizeBytes: 1024,
    blobKey: `blob:${id}`,
    proxyBlobKey: null,
    thumbnailBlobKey: null,
    waveform: null,
    durationMs: 30_000,
    width: 1920,
    height: 1080,
    frameRate: 30,
    hasAudio: true,
    videoCodec: 'avc1',
    playable: true,
    license: null,
    importedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 让所有微任务/挂起 promise 结算。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

/** 创建带全套假依赖的取帧器。 */
function createFixture(options?: { readAssetBlob?: (asset: Asset) => Promise<Blob | null> }): Fixture {
  const videos: FakeVideoElement[] = [];
  const images: FakeImageElement[] = [];
  const captures: Array<{ kind: 'video' | 'image'; sourceMs: number }> = [];
  const revoked: string[] = [];
  const urls = new Map<string, string>();
  const pendingCaptures: Array<() => void> = [];
  const fixture = { rejectedCaptures: 0 };
  let urlSeq = 0;

  const createVideoElement = (): HTMLVideoElement => {
    const element = new FakeVideoElement();
    videos.push(element);
    // 挂 src 后异步派发 loadeddata（模拟真实浏览器）
    queueMicrotask(() => element.markLoaded());
    return element as unknown as HTMLVideoElement;
  };
  const createImageElement = (): HTMLImageElement => {
    const element = new FakeImageElement();
    images.push(element);
    queueMicrotask(() => element.markLoaded());
    return element as unknown as HTMLImageElement;
  };

  const source = createPreviewFrameSource({
    readAssetBlob:
      options?.readAssetBlob ?? (async (): Promise<Blob | null> => new Blob(['x'])),
    createObjectURL: (): string => {
      urlSeq += 1;
      const url = `blob:fake/${urlSeq}`;
      urls.set(url, `asset_${urlSeq}`);
      return url;
    },
    revokeObjectURL: (url: string): void => {
      revoked.push(url);
    },
    captureFrame: (element: HTMLVideoElement | HTMLImageElement): Promise<ImageBitmap> =>
      new Promise<ImageBitmap>((resolve, reject) => {
      const isVideo = 'readyState' in element;
      captures.push({
        kind: isVideo ? 'video' : 'image',
        sourceMs: isVideo ? element.currentTime * 1000 : 0,
      });
      const shouldReject = fixture.rejectedCaptures > 0;
      pendingCaptures.push(() => {
        if (shouldReject) {
          fixture.rejectedCaptures -= 1;
          reject(new Error('decode failed'));
          return;
        }
        resolve(createFakeBitmap(`frame_${captures.length}`));
      });
    }),
    createImageElement: createImageElement,
    createPool: () => {
      const elements = new Map<string, HTMLVideoElement>();
      return {
        acquire: (assetId: string): HTMLVideoElement => {
          const existing = elements.get(assetId);
          if (existing) return existing;
          const element = createVideoElement();
          elements.set(assetId, element);
          return element;
        },
        sync: async (): Promise<void> => undefined,
        playAll: async (): Promise<void> => undefined,
        pauseAll: (): void => undefined,
        setMuted: (muted: boolean, assetId?: string): void => {
          if (assetId === undefined) {
            for (const video of elements.values()) video.muted = muted;
            return;
          }
          const video = elements.get(assetId);
          if (video) video.muted = muted;
        },
        dispose: (): void => {
          elements.clear();
        },
        get size(): number {
          return elements.size;
        },
        get mutedCount(): number {
          let count = 0;
          for (const video of elements.values()) if (video.muted) count += 1;
          return count;
        },
      };
    },
  });

  return {
    source,
    videos,
    images,
    captures,
    revoked,
    urls,
    pendingCaptures,
    get rejectedCaptures(): number {
      return fixture.rejectedCaptures;
    },
    set rejectedCaptures(value: number) {
      fixture.rejectedCaptures = value;
    },
  };
}

describe('services/media/previewFrameSource', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fixture.source.dispose();
  });

  it('getFrame 在元素未就绪时返回 null，且不抛异常', () => {
    const asset = makeVideoAsset('asset_a');
    fixture.source.ensureAsset(asset);

    // 同步调用（元素还在异步准备中）
    expect(fixture.source.getFrame('asset_a', 0)).toBeNull();
  });

  it('异步取帧完成后，同步 getFrame 能拿到缓存帧（核心回归防护）', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);
    expect(fixture.source.readyCount).toBe(1);

    // 第一次同步调用：还没有帧 → null，并触发异步抓帧
    expect(fixture.source.getFrame('asset_a', 1000)).toBeNull();
    await flush();

    // 抓帧 promise 已挂起，手动 resolve
    expect(fixture.pendingCaptures.length).toBe(1);
    fixture.pendingCaptures.shift()?.();
    await flush();

    // 再次同步调用同一个（容差内的）源时间 → 直接命中缓存
    const frame = fixture.source.getFrame('asset_a', 1000);
    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(1920);
  });

  it('容差内的重复取帧命中缓存，不再重复抓帧', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);

    fixture.source.getFrame('asset_a', 1000);
    await flush();
    fixture.pendingCaptures.shift()?.();
    await flush();

    const before = fixture.captures.length;
    // ±(AV_SYNC_TOLERANCE_MS - 1) 都应命中
    fixture.source.getFrame('asset_a', 1000 + AV_SYNC_TOLERANCE_MS - 1);
    fixture.source.getFrame('asset_a', 1000);
    fixture.source.getFrame('asset_a', 1000 - AV_SYNC_TOLERANCE_MS + 1);

    expect(fixture.captures.length).toBe(before);
  });

  it('超出容差时重新抓帧，但先返回上一帧（不黑屏）', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);

    fixture.source.getFrame('asset_a', 1000);
    await flush();
    fixture.pendingCaptures.shift()?.();
    await flush();
    const first = fixture.source.getFrame('asset_a', 1000);
    expect(first).not.toBeNull();

    // 跳到 5s（远超容差）→ 必须返回**上一帧**而不是 null
    const stale = fixture.source.getFrame('asset_a', 5000);
    expect(stale).toBe(first);

    await flush();
    expect(fixture.captures.length).toBe(2);
    fixture.pendingCaptures.shift()?.();
    await flush();

    // 新帧到位后返回的是新位图
    const fresh = fixture.source.getFrame('asset_a', 5000);
    expect(fresh).not.toBe(first);
  });

  it('未登记的 assetId 返回 null', () => {
    expect(fixture.source.getFrame('never_registered', 0)).toBeNull();
  });

  it('图片素材走 <img>，帧与源时间无关（任何时刻都返回同一帧）', async () => {
    const asset = makeVideoAsset('asset_img', { type: 'image', mimeType: 'image/png' });
    await fixture.source.ensureAsset(asset);

    expect(fixture.images.length).toBe(1);
    expect(fixture.videos.length).toBe(0);

    fixture.source.getFrame('asset_img', 0);
    await flush();
    fixture.pendingCaptures.shift()?.();
    await flush();

    const atZero = fixture.source.getFrame('asset_img', 0);
    // 图片没有「源时间」概念：任意时刻都应命中同一帧
    const atLater = fixture.source.getFrame('asset_img', 999_999);
    expect(atLater).toBe(atZero);
  });

  it('播放时 video 元素自己播，且不再每帧纠正 currentTime', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);
    const video = fixture.videos[0];
    expect(video).toBeDefined();

    fixture.source.setPlaying(true);
    expect(video?.playCount).toBe(1);
    expect(video?.paused).toBe(false);

    // 让元素位置跟随播放推进
    video!.currentTime = 1;
    const driftBefore = video!.currentTime;
    fixture.source.getFrame('asset_a', 1000);
    await flush();

    // 1s 处、无漂移 → 不应改写 currentTime
    expect(video!.currentTime).toBe(driftBefore);

    // 5s 处、漂移 4s → 必须纠正
    fixture.source.getFrame('asset_a', 5000);
    expect(video!.currentTime).toBe(5);
  });

  it('暂停时按 sourceMs 精确定位 video 元素', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);
    const video = fixture.videos[0];

    fixture.source.setPlaying(true);
    fixture.source.setPlaying(false);
    expect(video?.pauseCount).toBe(1);
    expect(video?.paused).toBe(true);

    fixture.source.getFrame('asset_a', 3000);
    await flush();
    expect(video?.currentTime).toBe(3);
  });

  it('变速同步到 video.playbackRate', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);

    fixture.source.setPlaybackRate(2);
    expect(fixture.videos[0]?.playbackRate).toBe(2);
    fixture.source.setPlaybackRate(0.5);
    expect(fixture.videos[0]?.playbackRate).toBe(0.5);
  });

  it('onFrameReady 在异步帧就绪时被通知，可用于立刻重绘', async () => {
    const asset = makeVideoAsset('asset_a');
    let notified = 0;
    const unsubscribe = fixture.source.onFrameReady(() => {
      notified += 1;
    });

    await fixture.source.ensureAsset(asset);
    const afterReady = notified;
    expect(afterReady).toBeGreaterThan(0);

    fixture.source.getFrame('asset_a', 1000);
    await flush();
    fixture.pendingCaptures.shift()?.();
    await flush();
    expect(notified).toBeGreaterThan(afterReady);

    unsubscribe();
    const snapshot = notified;
    fixture.source.getFrame('asset_a', 9000);
    await flush();
    fixture.pendingCaptures.shift()?.();
    await flush();
    expect(notified).toBe(snapshot);
  });

  it('prime 把元素定位到指定源时间并抓一帧', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);

    // prime 内部会await 抓帧，因此不能直接 await —— 先发起，再放行抓帧
    const primed = fixture.source.prime('asset_a', 2500);
    await flush();
    fixture.pendingCaptures.shift()?.();
    await primed;
    await flush();

    expect(fixture.videos[0]?.currentTime).toBe(2.5);
    expect(fixture.source.getFrame('asset_a', 2500)).not.toBeNull();
  });

  it('素材字节缺失时静默降级（不抛异常、不泄漏 objectURL）', async () => {
    const local = createFixture({ readAssetBlob: async (): Promise<Blob | null> => null });
    try {
      const asset = makeVideoAsset('asset_missing');
      await expect(local.source.ensureAsset(asset)).resolves.toBe(false);
      expect(local.source.readyCount).toBe(0);
      expect(local.source.getFrame('asset_missing', 0)).toBeNull();
      // 从未创建 objectURL → 无可 revoke
      expect(local.revoked.length).toBe(0);
    } finally {
      local.source.dispose();
    }
  });

  it('dispose 释放全部资源：revoke objectURL、关闭位图、dispose 池', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);
    fixture.source.getFrame('asset_a', 1000);
    await flush();
    fixture.pendingCaptures.shift()?.();
    await flush();

    const frame = fixture.source.getFrame('asset_a', 1000) as unknown as {
      close: ReturnType<typeof vi.fn>;
    };
    expect(fixture.revoked.length).toBe(0);

    fixture.source.dispose();

    // objectURL 已释放
    expect(fixture.revoked.length).toBe(1);
    // 位图已 close
    expect(frame.close).toHaveBeenCalled();
    // 元素已 pause + 卸载
    expect(fixture.videos[0]?.pauseCount).toBeGreaterThan(0);
    // 内部状态清空
    expect(fixture.source.assetCount).toBe(0);

    // dispose 幂等
    expect(() => fixture.source.dispose()).not.toThrow();
  });

  it('dispose 之后 getFrame 返回 null，不再触发任何异步工作', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);
    fixture.source.dispose();

    const capturesBefore = fixture.captures.length;
    expect(fixture.source.getFrame('asset_a', 1000)).toBeNull();
    await flush();
    expect(fixture.captures.length).toBe(capturesBefore);
  });

  it('同一 asset 重复 ensureAsset 是幂等的（不会重复建元素 / objectURL）', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);
    await fixture.source.ensureAsset(asset);
    await fixture.source.ensureAsset(asset);

    expect(fixture.source.assetCount).toBe(1);
    expect(fixture.videos.length).toBe(1);
    expect(fixture.revoked.length).toBe(0);
  });

  it('并发 getFrame 会被去重成一次抓帧（避免异步任务淹没主线程）', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);

    fixture.source.getFrame('asset_a', 1000);
    fixture.source.getFrame('asset_a', 1001);
    fixture.source.getFrame('asset_a', 1002);
    await flush();

    expect(fixture.captures.length).toBe(1);
  });

  it('抓帧抛异常时保留上一帧，且不把异常抛进渲染路径', async () => {
    const asset = makeVideoAsset('asset_a');
    await fixture.source.ensureAsset(asset);

    // 先成功抓一帧
    fixture.source.getFrame('asset_a', 1000);
    await flush();
    fixture.pendingCaptures.shift()?.();
    await flush();
    const good = fixture.source.getFrame('asset_a', 1000);
    expect(good).not.toBeNull();

    // 下一次抓帧 reject —— 用计数器标记，resolve 时以 reject 收场
    fixture.rejectedCaptures = 1;
    fixture.source.getFrame('asset_a', 9000);
    await flush();
    fixture.pendingCaptures.shift()?.();

    await flush();

    // 无论抓帧成败，getFrame 都不应抛，且仍返回上一帧
    expect(() => fixture.source.getFrame('asset_a', 9000)).not.toThrow();
    expect(fixture.source.getFrame('asset_a', 9000)).toBe(good);
  });
});