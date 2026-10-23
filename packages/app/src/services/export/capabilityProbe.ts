/**
 * 编码器能力矩阵探测（FR-044）。
 *
 * 产出 ARCHITECTURE §9.1 的 `CodecMatrix`，并**动态选择**默认导出格式
 * （PRD Q1：不硬编码默认值）。
 */

import { getAudioEncoderCtor, getVideoEncoderCtor } from '../../types/webcodecs.js';

/** 视频编码器能力。 */
export type VideoCodecKey = 'h264' | 'hevc' | 'vp9' | 'av1';

/** 音频编码器能力。 */
export type AudioCodecKey = 'aac' | 'opus';

/** 编码器能力矩阵。 */
export interface CodecMatrix {
  video: Record<VideoCodecKey, { supported: boolean; codec: string | null }>;
  audio: Record<AudioCodecKey, { supported: boolean; codec: string | null }>;
  recorder: { webm: boolean; mimeType: string | null };
  preferredExport: {
    format: 'mp4' | 'webm';
    video: string;
    audio: string | null;
    reason: string;
  };
}

/** 视频 codec 候选。 */
const VIDEO_CANDIDATES: Record<VideoCodecKey, { codec: string; mp4: 'avc' | 'hevc' | 'vp9' | 'av1' }> = {
  h264: { codec: 'avc1.640028', mp4: 'avc' },
  hevc: { codec: 'hvc1.1.6.L93.B0', mp4: 'hevc' },
  vp9: { codec: 'vp09.00.10.08', mp4: 'vp9' },
  av1: { codec: 'av01.0.04M.08', mp4: 'av1' },
};

/** 音频 codec 候选。 */
const AUDIO_CANDIDATES: Record<AudioCodecKey, string> = {
  aac: 'mp4a.40.2',
  opus: 'opus',
};

/** MediaRecorder mimeType 候选。 */
const RECORDER_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm',
];

/**
 * 探测编码器能力矩阵。
 */
export async function probeCodecMatrix(): Promise<CodecMatrix> {
  const video: Record<VideoCodecKey, { supported: boolean; codec: string | null }> = {
    h264: { supported: false, codec: null },
    hevc: { supported: false, codec: null },
    vp9: { supported: false, codec: null },
    av1: { supported: false, codec: null },
  };

  const audio: Record<AudioCodecKey, { supported: boolean; codec: string | null }> = {
    aac: { supported: false, codec: null },
    opus: { supported: false, codec: null },
  };

  const videoCtor = getVideoEncoderCtor();
  if (videoCtor) {
    for (const key of Object.keys(VIDEO_CANDIDATES) as VideoCodecKey[]) {
      const candidate = VIDEO_CANDIDATES[key];
      try {
        const result = await videoCtor.isConfigSupported({
          codec: candidate.codec,
          width: 1920,
          height: 1080,
          bitrate: 8_000_000,
          framerate: 30,
        });
        if (result.supported) {
          video[key] = { supported: true, codec: candidate.codec };
        }
      } catch {
        // 视为不支持
      }
    }
  }

  const audioCtor = getAudioEncoderCtor();
  if (audioCtor) {
    for (const key of Object.keys(AUDIO_CANDIDATES) as AudioCodecKey[]) {
      try {
        const result = await audioCtor.isConfigSupported({
          codec: AUDIO_CANDIDATES[key],
          sampleRate: 48_000,
          numberOfChannels: 2,
          bitrate: 192_000,
        });
        if (result.supported) {
          audio[key] = { supported: true, codec: AUDIO_CANDIDATES[key] };
        }
      } catch {
        // 视为不支持
      }
    }
  }

  const recorderMimeType = RECORDER_CANDIDATES.find((mimeType) => {
    if (typeof MediaRecorder === 'undefined') return false;
    try {
      return MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  });

  const recorder = {
    webm: recorderMimeType !== undefined,
    mimeType: recorderMimeType ?? null,
  };

  return {
    video,
    audio,
    recorder,
    preferredExport: pickPreferred(video, audio, recorder),
  };
}

/** 依据能力矩阵动态选择默认导出格式。 */
function pickPreferred(
  video: Record<VideoCodecKey, { supported: boolean; codec: string | null }>,
  audio: Record<AudioCodecKey, { supported: boolean; codec: string | null }>,
  recorder: { webm: boolean; mimeType: string | null },
): CodecMatrix['preferredExport'] {
  if (video.h264.supported) {
    const audioCodec = audio.aac.supported ? 'mp4a.40.2' : null;
    return {
      format: 'mp4',
      video: video.h264.codec ?? 'avc1.640028',
      audio: audioCodec,
      reason: audioCodec
        ? 'H.264 + AAC 完整支持，MP4 兼容性最好'
        : 'H.264 可用但 AAC 不可用，MP4 将不含音频',
    };
  }

  if (video.vp9.supported) {
    const audioCodec = audio.opus.supported ? 'opus' : null;
    return {
      format: 'webm',
      video: video.vp9.codec ?? 'vp09.00.10.08',
      audio: audioCodec,
      reason: 'H.264 不可用，回退到 VP9 + Opus（WebM）',
    };
  }

  if (recorder.webm) {
    return {
      format: 'webm',
      video: 'vp09.00.10.08',
      audio: 'opus',
      reason: 'WebCodecs 不可用，使用 MediaRecorder 兜底模式（性能较低）',
    };
  }

  return {
    format: 'webm',
    video: 'vp09.00.10.08',
    audio: 'opus',
    reason: '未检测到可用的硬编码器，建议更换浏览器（Chrome / Edge 111+）',
  };
}
