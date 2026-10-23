/**
 * 帧 / 缩略图 LRU 缓存。
 *
 * key = `assetId + 时间桶`，容量上限与内存压力保护。
 */

/** 缓存条目。 */
interface CacheEntry {
  bitmap: ImageBitmap;
  lastAccess: number;
}

/** 时间桶粒度（毫秒）。 */
export const FRAME_BUCKET_MS = 100;

/** 默认容量上限。 */
export const DEFAULT_FRAME_CACHE_CAPACITY = 64;

/**
 * 简单的 LRU 缓存。
 */
export class FrameCache {
  private readonly entries = new Map<string, CacheEntry>();

  private capacity: number;

  constructor(capacity: number = DEFAULT_FRAME_CACHE_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  /** 设置容量上限（超出时淘汰最旧条目）。 */
  setCapacity(capacity: number): void {
    this.capacity = Math.max(1, capacity);
    this.evictIfNeeded();
  }

  /** 构造缓存 key。 */
  static key(assetId: string, sourceMs: number, bucketMs = FRAME_BUCKET_MS): string {
    const bucket = Math.floor(Math.max(0, sourceMs) / bucketMs);
    return `${assetId}@${bucket}`;
  }

  /** 读取（命中时刷新 LRU 顺序）。 */
  get(assetId: string, sourceMs: number): ImageBitmap | undefined {
    const key = FrameCache.key(assetId, sourceMs);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.lastAccess = Date.now();
    return entry.bitmap;
  }

  /** 写入。 */
  set(assetId: string, sourceMs: number, bitmap: ImageBitmap): void {
    const key = FrameCache.key(assetId, sourceMs);
    const existing = this.entries.get(key);
    if (existing && existing.bitmap !== bitmap) {
      existing.bitmap.close?.();
    }
    this.entries.set(key, { bitmap, lastAccess: Date.now() });
    this.evictIfNeeded();
  }

  /** 淘汰超出容量的最旧条目。 */
  private evictIfNeeded(): void {
    while (this.entries.size > this.capacity) {
      let oldestKey: string | null = null;
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (entry.lastAccess < oldestTime) {
          oldestTime = entry.lastAccess;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      const entry = this.entries.get(oldestKey);
      entry?.bitmap.close?.();
      this.entries.delete(oldestKey);
    }
  }

  /** 释放全部位图。 */
  release(): void {
    for (const entry of this.entries.values()) {
      entry.bitmap.close?.();
    }
    this.entries.clear();
  }

  /** 当前条目数。 */
  get size(): number {
    return this.entries.size;
  }
}

/** 全局共享的帧缓存。 */
export const globalFrameCache = new FrameCache();
