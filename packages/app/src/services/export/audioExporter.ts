/**
 * 独立音频导出（FR-043）。
 *
 * 导出的是**混音总线**的结果：
 * - MP3：`AudioEncoder` 对 MP3 支持差，因此统一降级 WAV 并在 UI 明示；
 * - WAV：自研 PCM 编码，零依赖。
 */

import { getAudioEncoderCtor } from '../../types/webcodecs.js';

/** 音频导出格式。 */
export type AudioExportFormat = 'wav' | 'mp3' | 'aac';

/** 导出结果。 */
export interface AudioExportResult {
  blob: Blob;
  /** 实际使用的格式（可能与请求不同） */
  format: AudioExportFormat;
  /** 降级原因（未降级时为 null） */
  fallbackReason: string | null;
}

/**
 * 把 AudioBuffer 编码为 WAV（16bit PCM）。
 */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channelCount = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c += 1) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * 导出音频。
 *
 * @param buffer 混音总线的渲染结果
 * @param format 期望格式
 */
export async function exportAudio(
  buffer: AudioBuffer,
  format: AudioExportFormat = 'wav',
): Promise<AudioExportResult> {
  if (format === 'mp3') {
    const audioCtor = getAudioEncoderCtor();
    const mp3Supported = audioCtor
      ? await audioCtor
          .isConfigSupported({
            codec: 'mp3',
            sampleRate: buffer.sampleRate,
            numberOfChannels: buffer.numberOfChannels,
          })
          .then((result) => result.supported)
          .catch(() => false)
      : false;

    if (!mp3Supported) {
      return {
        blob: encodeWav(buffer),
        format: 'wav',
        fallbackReason: '当前浏览器的 AudioEncoder 不支持 MP3，已降级为 WAV。',
      };
    }
  }

  if (format === 'aac') {
    const audioCtor = getAudioEncoderCtor();
    const aacSupported = audioCtor
      ? await audioCtor
          .isConfigSupported({
            codec: 'mp4a.40.2',
            sampleRate: buffer.sampleRate,
            numberOfChannels: buffer.numberOfChannels,
          })
          .then((result) => result.supported)
          .catch(() => false)
      : false;

    if (!aacSupported) {
      return {
        blob: encodeWav(buffer),
        format: 'wav',
        fallbackReason: '当前浏览器不支持 AAC 编码，已降级为 WAV。',
      };
    }
  }

  return {
    blob: encodeWav(buffer),
    format: 'wav',
    fallbackReason: null,
  };
}
