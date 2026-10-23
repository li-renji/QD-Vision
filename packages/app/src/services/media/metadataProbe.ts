/**
 * 媒体元数据解析（FR-007）。
 *
 * 铁律：**任何解析失败都不阻塞导入** —— 此时 `durationMs = 0`、`playable = false`，
 * 由 UI 标注「未知时长 / 需转码」。
 */

import type { AssetType } from '@clipcut/shared-types';

/** 解析出的元数据。 */
export interface MediaMetadata {
  /** 时长（毫秒）；解析失败为 0 */
  durationMs: number;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  /** 浏览器能否解码播放 */
  playable: boolean;
  /** 解析过程中的警告（不阻塞导入） */
  warnings: string[];
}

/** 探测超时兜底（毫秒）——某些环境不会触发 load/error 事件。 */
const PROBE_TIMEOUT_MS = 2000;

/** 空的元数据。 */
function emptyMetadata(warnings: string[] = []): MediaMetadata {
  return {
    durationMs: 0,
    width: null,
    height: null,
    frameRate: null,
    hasAudio: false,
    videoCodec: null,
    playable: false,
    warnings,
  };
}

/** 把 Blob 读成 ArrayBuffer。 */
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/**
 * 解析视频元数据（`HTMLVideoElement`）。
 */
export async function probeVideo(blob: Blob): Promise<MediaMetadata> {
  const warnings: string[] = [];
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<MediaMetadata>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;

      const finish = (): void => {
        const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
        const width = video.videoWidth > 0 ? video.videoWidth : null;
        const height = video.videoHeight > 0 ? video.videoHeight : null;
        const playable = duration > 0 && width !== null;

        if (!playable) {
          warnings.push('浏览器无法解码该视频（可能是 .mov / 特殊编码），已标记为「需转码」。');
        }

        video.removeAttribute('src');
        video.load();
        resolve({
          durationMs: duration,
          width,
          height,
          frameRate: null,
          hasAudio: false,
          videoCodec: video.canPlayType('video/mp4; codecs="avc1.640028"') ? 'avc1.640028' : null,
          playable,
          warnings,
        });
      };

      video.addEventListener('loadedmetadata', finish, { once: true });
      video.addEventListener('error', () => {
        warnings.push('视频元数据读取失败，已标记为「未知时长」。');
        finish();
      }, { once: true });

      // 兜底：某些环境不会派发 loadedmetadata / error
      window.setTimeout(() => {
        if (video.readyState === 0) {
          warnings.push('视频元数据读取超时，已标记为「未知时长」。');
          finish();
        }
      }, PROBE_TIMEOUT_MS);

      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 解析音频元数据（`decodeAudioData`）。
 */
export async function probeAudio(blob: Blob): Promise<MediaMetadata> {
  const warnings: string[] = [];
  try {
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await blobToArrayBuffer(blob));
      return {
        durationMs: Math.round(buffer.duration * 1000),
        width: null,
        height: null,
        frameRate: null,
        hasAudio: true,
        videoCodec: null,
        playable: true,
        warnings,
      };
    } finally {
      void context.close();
    }
  } catch (error) {
    warnings.push(`音频解析失败：${error instanceof Error ? error.message : String(error)}`);
    return emptyMetadata(warnings);
  }
}

/**
 * 解析图片元数据（`Image` 解码）。
 */
export async function probeImage(blob: Blob): Promise<MediaMetadata> {
  const warnings: string[] = [];
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<MediaMetadata>((resolve) => {
      const image = document.createElement('img');
      const finish = (): void => {
        const width = image.naturalWidth > 0 ? image.naturalWidth : null;
        const height = image.naturalHeight > 0 ? image.naturalHeight : null;
        image.src = '';
        resolve({
          durationMs: 0,
          width,
          height,
          frameRate: null,
          hasAudio: false,
          videoCodec: null,
          playable: width !== null,
          warnings,
        });
      };

      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', () => {
        warnings.push('图片解码失败。');
        finish();
      }, { once: true });

      // 兜底：某些环境不会派发 load / error
      window.setTimeout(() => {
        if (!image.complete) {
          warnings.push('图片解码超时。');
          finish();
        }
      }, PROBE_TIMEOUT_MS);

      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 按素材类型解析元数据。
 */
export async function probeMedia(blob: Blob, type: AssetType): Promise<MediaMetadata> {
  try {
    switch (type) {
      case 'video':
        return await probeVideo(blob);
      case 'audio':
        return await probeAudio(blob);
      case 'image':
        return await probeImage(blob);
      default:
        return emptyMetadata(['未知的素材类型']);
    }
  } catch (error) {
    return emptyMetadata([
      `元数据解析异常：${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}
