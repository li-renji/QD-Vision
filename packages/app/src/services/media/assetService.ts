/**
 * 素材导入编排（FR-006 / FR-007 / FR-009）。
 *
 * 流程：格式校验 → 落盘 Blob → 探测元数据 → 生成缩略图 / 波形 → 写入 `assets`。
 *
 * 铁律：**素材字节只走 Blob → IndexedDB**，本文件不发起任何网络请求。
 */

import type { Asset, AssetType } from '@clipcut/shared-types';
import { detectAssetType, unsupportedReason } from '../../platform/fileTypes.js';
import { assetId as newAssetId } from '../../utils/id.js';
import { addAsset } from '../../state/actions.js';
import { BlobKeys } from '../storage/db.js';
import { putBlob } from '../storage/blobRepo.js';
import { probeMedia } from './metadataProbe.js';
import { generateThumbnail } from './thumbnailService.js';
import { computeWaveform } from './waveformService.js';

/** 导入结果。 */
export interface ImportResult {
  /** 成功导入的数量 */
  imported: number;
  /** 失败的数量 */
  failed: number;
  /** 失败原因（逐条） */
  reasons: string[];
  /** 成功导入的素材 */
  assets: Asset[];
}

/**
 * 导入一批文件。
 */
export async function importFiles(files: readonly File[]): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, failed: 0, reasons: [], assets: [] };

  for (const file of files) {
    try {
      const asset = await importFile(file);
      if (!asset) {
        result.failed += 1;
        result.reasons.push(unsupportedReason(file.name));
        continue;
      }
      result.imported += 1;
      result.assets.push(asset);
    } catch (error) {
      result.failed += 1;
      result.reasons.push(
        `导入「${file.name}」失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}

/**
 * 导入单个文件。
 *
 * @returns 导入的素材；格式不支持时返回 null。
 */
export async function importFile(file: File): Promise<Asset | null> {
  const type = detectAssetType(file.name, file.type);
  if (!type) return null;

  const id = newAssetId();
  const blobKey = BlobKeys.asset(id);

  // 1) 先落盘，保证即使后续解析失败素材也不会丢失
  await putBlob(blobKey, file);

  // 2) 探测元数据（失败不阻塞）
  const metadata = await probeMedia(file, type);

  // 3) 缩略图 / 波形
  let thumbnailBlobKey: string | null = null;
  let waveform: number[] | null = null;

  if (type === 'video' && metadata.playable) {
    thumbnailBlobKey = await generateThumbnail(id, file);
  }
  if (type === 'audio') {
    waveform = await computeWaveform(file);
  }

  const asset: Asset = {
    id,
    type,
    name: file.name,
    sourceType: 'local',
    mimeType: file.type || guessMimeType(type, file.name),
    sizeBytes: file.size,
    blobKey,
    proxyBlobKey: null,
    thumbnailBlobKey,
    waveform,
    durationMs: metadata.durationMs,
    width: metadata.width,
    height: metadata.height,
    frameRate: metadata.frameRate ?? (type === 'video' ? 30 : null),
    hasAudio: metadata.hasAudio || (type === 'video' && metadata.playable),
    videoCodec: metadata.videoCodec,
    playable: metadata.playable,
    license: null,
    importedAt: new Date().toISOString(),
  };

  // 4) 写入工程（一次历史记录）
  addAsset(asset);

  return asset;
}

/** MIME 兜底推断。 */
function guessMimeType(type: AssetType, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (type === 'video') {
    if (ext === 'webm') return 'video/webm';
    if (ext === 'mov') return 'video/quicktime';
    return 'video/mp4';
  }
  if (type === 'audio') {
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'ogg') return 'audio/ogg';
    if (ext === 'm4a') return 'audio/mp4';
    return 'audio/mpeg';
  }
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}
