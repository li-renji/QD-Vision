/**
 * 波形峰值计算（FR-009②）。
 *
 * 解码 PCM → 分桶取**峰值**（每桶取 max abs）→ 归一化到 0~1 → 默认 400 个采样点。
 */

import { DEFAULT_WAVEFORM_POINTS } from './constants.js';

/**
 * 计算波形峰值数组。
 *
 * @param blob 音频 Blob
 * @param points 采样点数量，默认 400
 * @returns 归一化到 0~1 的数组；解析失败时返回 null
 */
export async function computeWaveform(blob: Blob, points = DEFAULT_WAVEFORM_POINTS): Promise<number[] | null> {
  try {
    const context = new AudioContext();
    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(await blob.arrayBuffer());
    } finally {
      void context.close();
    }

    const channelCount = buffer.numberOfChannels;
    const length = buffer.length;
    if (length === 0 || channelCount === 0) return new Array<number>(points).fill(0);

    // 多声道取各声道绝对值的最大值
    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c += 1) {
      channels.push(buffer.getChannelData(c));
    }

    const bucketSize = Math.max(1, Math.floor(length / points));
    const peaks: number[] = [];

    for (let i = 0; i < points; i += 1) {
      const start = i * bucketSize;
      const end = Math.min(length, start + bucketSize);
      let peak = 0;
      for (let c = 0; c < channels.length; c += 1) {
        const data = channels[c];
        if (!data) continue;
        for (let j = start; j < end; j += 1) {
          const value = Math.abs(data[j] ?? 0);
          if (value > peak) peak = value;
        }
      }
      peaks.push(peak);
    }

    const max = peaks.reduce((acc, value) => Math.max(acc, value), 0);
    if (max <= 0) return peaks.map(() => 0);
    return peaks.map((value) => Number((value / max).toFixed(4)));
  } catch {
    return null;
  }
}
