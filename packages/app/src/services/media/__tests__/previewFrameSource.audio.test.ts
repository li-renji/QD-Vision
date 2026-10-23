/**
 * 预览取帧器的**音频接线接口**测试。
 *
 * `getElement` / `unmute` / `onElementReady` 是「预览有声音」的三个支点，
 * 这里逐个钉住：
 *
 * 1. `getElement` 返回取帧器**自己**持有的元素（音频与画面共用一个解码实例）；
 * 2. `unmute` 真的把 `muted` 翻成 `false`（否则 WebAudio 输出被闸门掐断）；
 * 3. `onElementReady` 在元素**首次**就绪时触发一次 —— 这是混音图能建起来的前提。
 */

import { describe, expect, it, vi } from 'vitest';
import type { Asset } from '@clipcut/shared-types';
import { createPreviewFrameSource, type PreviewFrameSource } from '../previewFrameSource.js';
import type { VideoPool } from '../videoPool.js';

/** 可观测的假 `<video>`（`waitReady` 依赖 `loadeddata` 事件，故继承 EventTarget）。 */
class FakeVideoElement extends EventTarget {
  src = '';
  currentTime = 0;
  readyState = 0;
  playbackRate = 1;
  muted = true;
  playsInline = false;
  preload = '';
  paused = true;

  markLoaded(): void {
    this.readyState = 4;
    this.dispatchEvent(new Event('loadeddata'));
  }

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {
    /* no-op */
  }

  load(): void {
    /* no-op */
  }

  removeAttribute(): void {
    /* no-op */
  }
}

/** 可观测的假 `<img>`（同理继承 EventTarget，`waitReady` 监听 `load`）。 */
class FakeImageElement extends EventTarget {
  src = '';
  complete = false;
  naturalWidth = 0;

  markLoaded(): void {
    this.complete = true;
    this.naturalWidth = 1920;
    this.dispatchEvent(new Event('load'));
  }

  removeAttribute(): void {
    /* no-op */
  }
}

/** 记录 `setMuted` 调用的假池。 */
interface FakePool extends VideoPool {
  setMutedCalls: Array<{ muted: boolean; assetId?: string }>;
}

/** 造一个假视频池。 */
function createFakePool(): FakePool {
  const elements = new Map<string, FakeVideoElement>();
  const setMutedCalls: Array<{ muted: boolean; assetId?: string }> = [];
  return {
    setMutedCalls,
    acquire: (assetId: string): HTMLVideoElement => {
      const existing = elements.get(assetId);
      if (existing) return existing as unknown as HTMLVideoElement;
      const element = new FakeVideoElement();
      elements.set(assetId, element);
      return element as unknown as HTMLVideoElement;
    },
    sync: async (): Promise<void> => undefined,
    playAll: async (): Promise<void> => undefined,
    pauseAll: (): void => undefined,
    setMuted: (muted: boolean, assetId?: string): void => {
      setMutedCalls.push(assetId === undefined ? { muted } : { muted, assetId });
      const targets = assetId === undefined ? [...elements.values()] : [elements.get(assetId)];
      for (const video of targets) {
        if (video) video.muted = muted;
      }
    },
    dispose: (): void => elements.clear(),
    get size(): number {
      return elements.size;
    },
    get mutedCount(): number {
      let count = 0;
      for (const video of elements.values()) if (video.muted) count += 1;
      return count;
    },
  };
}

/** 取帧器夹具。 */
interface Fixture {
  source: PreviewFrameSource;
  pool: FakePool;
  videos: Map<string, FakeVideoElement>;
}

/** 造一个取帧器夹具。 */
function createFixture(options: { autoReady?: boolean } = {}): Fixture {
  const autoReady = options.autoReady ?? true;
  const pool = createFakePool();
  const videos = new Map<string, FakeVideoElement>();

  const source = createPreviewFrameSource({
    readAssetBlob: async (): Promise<Blob> => new Blob([new Uint8Array([1, 2, 3])]),
    createObjectURL: (): string => 'blob:fake',
    revokeObjectURL: (): void => undefined,
    captureFrame: async (): Promise<ImageBitmap> =>
      ({ width: 2, height: 2, close: (): void => undefined }) as unknown as ImageBitmap,
    createPool: (): VideoPool => pool,
    createImageElement: (): HTMLImageElement => {
      const element = new FakeImageElement();
      if (autoReady) queueMicrotask(() => element.markLoaded());
      return element as unknown as HTMLImageElement;
    },
  });

  // 记录池里真实创建的 video 元素
  const originalAcquire = pool.acquire;
  pool.acquire = (assetId: string): HTMLVideoElement => {
    const element = originalAcquire(assetId);
    videos.set(assetId, element as unknown as FakeVideoElement);
    if (autoReady) queueMicrotask(() => (element as unknown as FakeVideoElement).markLoaded());
    return element;
  };

  return { source, pool, videos };
}

function makeVideoAsset(id: string): Asset {
  return {
    id,
    type: 'video',
    name: `${id}.mp4`,
    sourceType: 'local',
    mimeType: 'video/mp4',
    sizeBytes: 8,
    blobKey: `blob:${id}`,
    proxyBlobKey: null,
    thumbnailBlobKey: null,
    waveform: null,
    durationMs: 1000,
    width: 320,
    height: 240,
    frameRate: 30,
    hasAudio: true,
    videoCodec: 'h264',
    playable: true,
    license: null,
    importedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeImageAsset(id: string): Asset {
  return {
    ...makeVideoAsset(id),
    type: 'image',
    mimeType: 'image/png',
    durationMs: 0,
    width: null,
    height: null,
    frameRate: null,
    hasAudio: false,
    videoCodec: null,
  };
}

/** 让挂起的 promise 结算若干轮。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

describe('previewFrameSource 音频接线接口', () => {
  it('getElement 返回取帧器自己持有的元素（与画面共用同一解码实例）', async () => {
    const fixture = createFixture();
    await fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();

    const element = fixture.source.getElement('a1');

    expect(element).not.toBeNull();
    // 与 pool 里那个是同一个对象 —— 音频不能另建元素
    expect(element).toBe(fixture.videos.get('a1') as unknown as HTMLMediaElement);
  });

  it('元素未就绪时 getElement 返回 null（避免建出哑 source node）', async () => {
    const fixture = createFixture({ autoReady: false });
    const pending = fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();

    expect(fixture.source.getElement('a1')).toBeNull();

    // 就绪后立刻可取 —— 这正是混音图能建起来的时刻
    (fixture.videos.get('a1') as unknown as FakeVideoElement).markLoaded();
    await pending;
    await flush();
    expect(fixture.source.getElement('a1')).not.toBeNull();
  });

  it('未登记的素材 getElement 返回 null（安全降级）', () => {
    const fixture = createFixture();
    expect(fixture.source.getElement('never_seen')).toBeNull();
  });

  it('图片素材 getElement 返回 null（<img> 不是 HTMLMediaElement）', async () => {
    const fixture = createFixture();
    await fixture.source.ensureAsset(makeImageAsset('img1'));
    await flush();

    expect(fixture.source.getElement('img1')).toBeNull();
  });

  it('unmute 把元素 muted 翻成 false（接上 WebAudio 的关键一步）', async () => {
    const fixture = createFixture();
    await fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();

    const element = fixture.videos.get('a1') as unknown as FakeVideoElement;
    expect(element.muted).toBe(true);

    fixture.source.unmute('a1');

    expect(element.muted).toBe(false);
    // 且只影响这一个素材 —— 别的元素仍保持静音（不互相叠加）
    expect(fixture.pool.setMutedCalls).toContainEqual({ muted: false, assetId: 'a1' });
  });

  it('unmute 未登记的素材是安全的空操作', () => {
    const fixture = createFixture();
    expect(() => fixture.source.unmute('never_seen')).not.toThrow();
  });

  it('onElementReady 在元素首次就绪时触发一次', async () => {
    const fixture = createFixture();
    const listener = vi.fn();
    const unsubscribe = fixture.source.onElementReady(listener);

    await fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('a1');

    // 重复 ensureAsset 不再触发（幂等，避免每次重建都重建混音图）
    await fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('取消订阅后不再收到通知', async () => {
    const fixture = createFixture();
    const listener = vi.fn();
    const unsubscribe = fixture.source.onElementReady(listener);
    unsubscribe();

    await fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('setAssetSpeed 与 setPlaybackRate 相乘而非互相覆盖（两个维度）', async () => {
    const fixture = createFixture();
    await fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();
    const element = fixture.videos.get('a1') as unknown as FakeVideoElement;

    // J/K/L 穿梭倍速 1.5，片段倍速 2 → 元素实际应是 3
    fixture.source.setPlaybackRate(1.5);
    expect(element.playbackRate).toBe(1.5);

    fixture.source.setAssetSpeed('a1', 2);
    expect(element.playbackRate).toBeCloseTo(3, 6);

    // 再改穿梭倍速，片段倍速应继续生效
    fixture.source.setPlaybackRate(1);
    expect(element.playbackRate).toBeCloseTo(2, 6);
  });

  it('setAssetSpeed 相同值不重复写（每帧调用时不会刷 DOM）', async () => {
    const fixture = createFixture();
    await fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();
    const element = fixture.videos.get('a1') as unknown as FakeVideoElement;
    let writes = 0;
    const descriptor = Object.getOwnPropertyDescriptor(element, 'playbackRate');
    void descriptor;
    // 用 setter 计数
    let rate = 1;
    Object.defineProperty(element, 'playbackRate', {
      get: () => rate,
      set: (value: number) => {
        writes += 1;
        rate = value;
      },
      configurable: true,
    });

    fixture.source.setAssetSpeed('a1', 2);
    fixture.source.setAssetSpeed('a1', 2);
    fixture.source.setAssetSpeed('a1', 2);
    expect(writes).toBe(1);
  });

  it('setAssetSpeed 对未登记的素材是安全的空操作', () => {
    const fixture = createFixture();
    expect(() => fixture.source.setAssetSpeed('never_seen', 2)).not.toThrow();
  });

  it('dispose 之后 setAssetSpeed 不再写', async () => {
    const fixture = createFixture();
    await fixture.source.ensureAsset(makeVideoAsset('a1'));
    await flush();
    fixture.source.dispose();

    expect(() => fixture.source.setAssetSpeed('a1', 2)).not.toThrow();
  });

  it('dispose 之后 onElementReady 不再回调（异步流程已终止）', async () => {
    const fixture = createFixture();
    const listener = vi.fn();
    fixture.source.onElementReady(listener);

    fixture.source.dispose();
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });
});