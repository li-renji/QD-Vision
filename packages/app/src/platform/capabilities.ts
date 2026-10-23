/**
 * 运行时能力探测。
 *
 * 探测结果**模块级缓存**，避免重复调用 `isConfigSupported` 的开销。
 *
 * 注意：本文件位于 `platform/` 白名单目录，允许访问 `window` / `navigator`。
 */

import type { PlatformCapabilities } from './PlatformBridge.js';
import {
  getAudioEncoderCtor,
  getVideoDecoderCtor,
  getVideoEncoderCtor,
  type VideoEncoderConfigLike,
} from '../types/webcodecs.js';

/** 待探测的视频编码器候选。 */
export const VIDEO_CODEC_CANDIDATES: readonly { key: string; codec: string }[] = [
  { key: 'h264-baseline', codec: 'avc1.42E01E' },
  { key: 'h264-high', codec: 'avc1.640028' },
  { key: 'hevc', codec: 'hvc1.1.6.L93.B0' },
  { key: 'vp9', codec: 'vp09.00.10.08' },
  { key: 'av1', codec: 'av01.0.04M.08' },
] as const;

/** 待探测的音频编码器候选。 */
export const AUDIO_CODEC_CANDIDATES: readonly { key: string; codec: string }[] = [
  { key: 'aac', codec: 'mp4a.40.2' },
  { key: 'opus', codec: 'opus' },
] as const;

/** 待探测的 MediaRecorder mimeType 候选。 */
export const RECORDER_MIME_CANDIDATES: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm',
] as const;

/** 探测用的基准分辨率（能力探测只需一个合法配置）。 */
const PROBE_WIDTH = 1920;
const PROBE_HEIGHT = 1080;
const PROBE_FPS = 30;
const PROBE_SAMPLE_RATE = 48_000;
const PROBE_CHANNELS = 2;

function isMobileUserAgent(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(userAgent);
}

function hasFileSystemAccess(): boolean {
  const win = window as unknown as {
    showOpenFilePicker?: unknown;
    showSaveFilePicker?: unknown;
    showDirectoryPicker?: unknown;
  };
  return (
    typeof win.showOpenFilePicker === 'function' &&
    typeof win.showSaveFilePicker === 'function' &&
    typeof win.showDirectoryPicker === 'function'
  );
}

async function probeVideoCodecs(): Promise<string[]> {
  const ctor = getVideoEncoderCtor();
  if (!ctor) return [];

  const supported: string[] = [];
  for (const candidate of VIDEO_CODEC_CANDIDATES) {
    const config: VideoEncoderConfigLike = {
      codec: candidate.codec,
      width: PROBE_WIDTH,
      height: PROBE_HEIGHT,
      bitrate: 8_000_000,
      framerate: PROBE_FPS,
    };
    try {
      const result = await ctor.isConfigSupported(config);
      if (result.supported) supported.push(candidate.codec);
    } catch {
      // 某些浏览器对非法 codec 串直接抛错，视为不支持。
    }
  }
  return supported;
}

async function probeAudioCodecs(): Promise<string[]> {
  const ctor = getAudioEncoderCtor();
  if (!ctor) return [];

  const supported: string[] = [];
  for (const candidate of AUDIO_CODEC_CANDIDATES) {
    try {
      const result = await ctor.isConfigSupported({
        codec: candidate.codec,
        sampleRate: PROBE_SAMPLE_RATE,
        numberOfChannels: PROBE_CHANNELS,
        bitrate: 192_000,
      });
      if (result.supported) supported.push(candidate.codec);
    } catch {
      // 同上
    }
  }
  return supported;
}

function probeRecorderMimeTypes(): string[] {
  if (typeof MediaRecorder === 'undefined') return [];
  return RECORDER_MIME_CANDIDATES.filter((mimeType) => {
    try {
      return MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  });
}

/** 立即执行一次完整能力探测（不缓存）。 */
export async function detectCapabilities(): Promise<PlatformCapabilities> {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const [videoCodecs, audioCodecs] = await Promise.all([probeVideoCodecs(), probeAudioCodecs()]);
  const recorderMimeTypes = probeRecorderMimeTypes();
  const hasDecoder = getVideoDecoderCtor() !== undefined;

  return {
    fileSystemAccess: hasFileSystemAccess(),
    webCodecs: videoCodecs.length > 0 && hasDecoder,
    mediaRecorder: recorderMimeTypes.length > 0,
    webGpu:
      typeof navigator !== 'undefined' &&
      (navigator as Navigator & { gpu?: unknown }).gpu !== undefined,
    indexedDb: typeof indexedDB !== 'undefined',
    supportedVideoCodecs: videoCodecs,
    supportedAudioCodecs: audioCodecs,
    supportedRecorderMimeTypes: recorderMimeTypes,
    userAgent,
    isMobile: isMobileUserAgent(userAgent),
  };
}

/** 能力缓存。 */
let cachedCapabilities: PlatformCapabilities | null = null;

/**
 * 取得（并缓存）能力矩阵。
 *
 * @param forceRefresh 为 true 时跳过缓存重新探测。
 */
export async function getCapabilities(forceRefresh = false): Promise<PlatformCapabilities> {
  if (!forceRefresh && cachedCapabilities) return cachedCapabilities;
  cachedCapabilities = await detectCapabilities();
  return cachedCapabilities;
}

/** 清空能力缓存（测试用）。 */
export function resetCapabilitiesCache(): void {
  cachedCapabilities = null;
}
