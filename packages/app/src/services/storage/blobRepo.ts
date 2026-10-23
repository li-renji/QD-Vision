/**
 * Blob 存取（素材二进制唯一落盘位置）。
 *
 * 主键规则见 `BlobKeys`：`blob:asset_x` / `thumb:asset_x` / `proxy:asset_x` / `export:job_x`。
 */

import { getDb } from './db.js';

/** 写入一个 Blob。 */
export async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('blobs', blob, key);
}

/** 读取一个 Blob；不存在时返回 null。 */
export async function getBlobByKey(key: string): Promise<Blob | null> {
  const db = await getDb();
  const value = await db.get('blobs', key);
  return value ?? null;
}

/** 删除一个 Blob。 */
export async function deleteBlob(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('blobs', key);
}

/** 判断某个 key 是否存在。 */
export async function hasBlob(key: string): Promise<boolean> {
  const db = await getDb();
  const count = await db.count('blobs', key);
  return count > 0;
}

/**
 * 找出**缺失**的 blob key。
 *
 * 这是 relink 流程的核心：导入工程后比对工程内的 blobKey 集合，
 * 缺失的素材标记为「离线缺失」。
 */
export async function getMissingBlobKeys(keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const db = await getDb();
  const missing: string[] = [];
  for (const key of keys) {
    const count = await db.count('blobs', key);
    if (count === 0) missing.push(key);
  }
  return missing;
}

/** 返回所有 blob key。 */
export async function listBlobKeys(): Promise<string[]> {
  const db = await getDb();
  return db.getAllKeys('blobs');
}

/** 估算存储占用（字节）。 */
export async function estimateUsage(): Promise<number> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? 0;
  }
  return 0;
}

/** 删除一组 blob key（忽略不存在项）。 */
export async function deleteBlobs(keys: readonly string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('blobs', 'readwrite');
  await Promise.all([...keys.map((key) => tx.store.delete(key)), tx.done]);
}
