/**
 * 支持的媒体格式白名单（FR-006 的唯一来源）。
 *
 * 新增格式必须同时更新此处与 `docs/PRD.md`，避免多处定义漂移。
 */

import type { AssetType } from '@clipcut/shared-types';

/** 文件扩展名 → 素材类型。 */
export const SUPPORTED_EXTENSIONS: Readonly<Record<string, AssetType>> = {
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4a: 'audio',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
};

/** MIME → 素材类型。 */
export const SUPPORTED_MIME_TYPES: Readonly<Record<string, AssetType>> = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mp4': 'audio',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/wave': 'audio',
  'audio/ogg': 'audio',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
};

/** 文件选择框的 accept 串。 */
export const FILE_ACCEPT = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
].join(',');

/** 扩展名列表（不含点）。 */
export const SUPPORTED_EXTENSION_LIST: readonly string[] = Object.keys(SUPPORTED_EXTENSIONS);

/** 取文件名的扩展名（小写，不含点）。 */
export function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index < 0 || index === fileName.length - 1) return '';
  return fileName.slice(index + 1).toLowerCase();
}

/** 判断扩展名是否受支持。 */
export function isSupportedExtension(fileName: string): boolean {
  return getExtension(fileName) in SUPPORTED_EXTENSIONS;
}

/** 判断 MIME 是否受支持。 */
export function isSupportedMime(mimeType: string): boolean {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return normalized in SUPPORTED_MIME_TYPES;
}

/**
 * 推断素材类型。
 *
 * 优先使用 MIME（更可靠），退化到扩展名；两者都无法识别时返回 `null`。
 */
export function detectAssetType(fileName: string, mimeType?: string): AssetType | null {
  const normalized = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const byMime = SUPPORTED_MIME_TYPES[normalized];
  if (byMime) return byMime;

  const byExt = SUPPORTED_EXTENSIONS[getExtension(fileName)];
  if (byExt) return byExt;

  return null;
}

/** 不支持格式时的用户可读原因。 */
export function unsupportedReason(fileName: string): string {
  const ext = getExtension(fileName);
  if (!ext) return `不支持的文件格式：${fileName}（缺少扩展名）`;
  return `不支持的文件格式：.${ext}（受支持：${SUPPORTED_EXTENSION_LIST.join(' / ')}）`;
}
