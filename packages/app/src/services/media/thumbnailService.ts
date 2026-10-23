/**
 * 缩略图生成（FR-009①）。
 *
 * 视频取**第 1s 帧** → `createImageBitmap` → PNG Blob。
 * 二次打开工程时若 blob 已存在则**直接复用，不重新生成**。
 */

import { BlobKeys } from '../storage/db.js';
import { getBlobByKey, putBlob } from '../storage/blobRepo.js';

/**
 * 从视频 Blob 抓取一帧并编码为 PNG。
 *
 * @param blob 视频 Blob
 * @param atMs 取帧位置（毫秒），默认 1000
 * @returns PNG Blob；失败时返回 null
 */
export async function captureFrameBlob(blob: Blob, atMs = 1000): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const seeked = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      video.addEventListener('loadeddata', () => {
        video.currentTime = Math.min(atMs / 1000, Math.max(0, video.duration - 0.05));
      }, { once: true });
      video.addEventListener('seeked', () => done(true), { once: true });
      video.addEventListener('error', () => done(false), { once: true });
      video.src = url;
    });

    if (!seeked || video.videoWidth === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/png');
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 生成并保存缩略图。
 *
 * @param assetId 素材 id
 * @param blob 视频 Blob
 * @returns 缩略图的 blobKey；失败时返回 null
 */
export async function generateThumbnail(assetId: string, blob: Blob): Promise<string | null> {
  const key = BlobKeys.thumbnail(assetId);

  // 已存在则直接复用（不重新生成）
  const existing = await getBlobByKey(key);
  if (existing) return key;

  const thumbnail = await captureFrameBlob(blob, 1000);
  if (!thumbnail) return null;

  await putBlob(key, thumbnail);
  return key;
}
