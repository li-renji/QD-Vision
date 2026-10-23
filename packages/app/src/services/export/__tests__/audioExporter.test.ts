/**
 * 独立音频导出测试（BUG-04 / FR-043）。
 *
 * 覆盖两条主线：
 * 1. `encodeWav` —— 自研 16bit PCM WAV 编码器（**纯函数，可精确断言字节**）；
 * 2. `exportAudio` —— 格式协商与**降级链路**（MP3 / AAC 不支持 → 降级 WAV 并说明原因）。
 *
 * 本环境**不尝试真正编码 MP3 / AAC**（happy-dom 无 `AudioEncoder`），
 * 只验证「能力探测 → 降级选择 → 结果标注」这条链路。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, exportAudio, type AudioExportFormat } from '../audioExporter.js';

/** 造一个假 AudioBuffer。 */
function makeAudioBuffer(
  channels: number,
  frames: number,
  sampleRate = 48_000,
): AudioBuffer {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) {
    data.push(new Float32Array(frames));
  }
  return {
    numberOfChannels: channels,
    sampleRate,
    length: frames,
    duration: frames / sampleRate,
    getChannelData: (c: number) => data[c] ?? new Float32Array(frames),
  } as unknown as AudioBuffer;
}

/** 读取 Blob 的字节。 */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** 读取 WAV 头部的 ASCII 字符串。 */
function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/** 读取小端 uint32。 */
function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    ((bytes[offset + 1] ?? 0) << 8) +
    ((bytes[offset + 2] ?? 0) << 16) +
    ((bytes[offset + 3] ?? 0) << 24)
  );
}

/** 读取小端 uint16。 */
function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8);
}

/** 读取小端 **有符号** int16。 */
function readInt16(bytes: Uint8Array, offset: number): number {
  const value = readUint16(bytes, offset);
  return value >= 0x8000 ? value - 0x1_0000 : value;
}

describe('services/export/audioExporter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('encodeWav', () => {
    it('生成 RIFF/WAVE 头', async () => {
      const blob = encodeWav(makeAudioBuffer(1, 10));

      expect(blob.type).toBe('audio/wav');

      const bytes = await blobBytes(blob);
      expect(readAscii(bytes, 0, 4)).toBe('RIFF');
      expect(readAscii(bytes, 8, 4)).toBe('WAVE');
      expect(readAscii(bytes, 12, 4)).toBe('fmt ');
      expect(readAscii(bytes, 36, 4)).toBe('data');
    });

    it('fmt 块描述 16bit PCM 与正确的声道 / 采样率', async () => {
      const blob = encodeWav(makeAudioBuffer(2, 100, 44_100));

      const bytes = await blobBytes(blob);
      expect(readUint32(bytes, 16)).toBe(16); // fmt chunk size
      expect(readUint16(bytes, 20)).toBe(1); // PCM
      expect(readUint16(bytes, 22)).toBe(2); // channels
      expect(readUint32(bytes, 24)).toBe(44_100); // sample rate
      expect(readUint16(bytes, 32)).toBe(4); // blockAlign = 2ch * 2byte
      expect(readUint16(bytes, 34)).toBe(16); // bits per sample
    });

    it('数据块大小与总长度自洽', async () => {
      const frames = 100;
      const blob = encodeWav(makeAudioBuffer(2, frames));

      const bytes = await blobBytes(blob);
      const dataSize = frames * 2 * 2; // 帧数 × 声道 × 2 字节
      expect(readUint32(bytes, 40)).toBe(dataSize);
      expect(readUint32(bytes, 4)).toBe(36 + dataSize);
      expect(bytes.length).toBe(44 + dataSize);
    });

    it('样本按 16bit 有符号整数写入（0.5 → 16383）', async () => {
      const buffer = makeAudioBuffer(1, 2);
      const channel = buffer.getChannelData(0);
      channel[0] = 0.5;
      channel[1] = -0.5;

      const bytes = await blobBytes(encodeWav(buffer));

      // 正样本 × 0x7fff（setInt16 向零截断：0.5×32767=16383.5 → 16383）
      expect(readInt16(bytes, 44)).toBe(16383);
      // 负样本 × 0x8000（-0.5×32768 = -16384）
      expect(readInt16(bytes, 46)).toBe(-16384);
    });

    it('多声道按帧交错（帧0 的 L/R 相邻）', async () => {
      const buffer = makeAudioBuffer(2, 2);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      left[0] = 1;
      right[0] = -1;
      left[1] = 0.25;
      right[1] = -0.25;

      const bytes = await blobBytes(encodeWav(buffer));

      // 帧 0：L=1 → 0x7fff，R=-1 → -0x8000
      expect(readInt16(bytes, 44)).toBe(32767);
      expect(readInt16(bytes, 46)).toBe(-32768);
      // 帧 1：L=0.25 → 8191（截断），R=-0.25 → -8192
      expect(readInt16(bytes, 48)).toBe(8191);
      expect(readInt16(bytes, 50)).toBe(-8192);
    });

    it('样本被裁剪到 [-1, 1]（不溢出 int16）', async () => {
      const buffer = makeAudioBuffer(1, 2);
      const channel = buffer.getChannelData(0);
      channel[0] = 5;
      channel[1] = -5;

      const bytes = await blobBytes(encodeWav(buffer));

      expect(readInt16(bytes, 44)).toBe(32767);
      expect(readInt16(bytes, 46)).toBe(-32768);
    });
  });

  describe('exportAudio', () => {
    it('WAV 格式直接编码，不做任何能力探测', async () => {
      const isConfigSupported = vi.fn();
      vi.stubGlobal('AudioEncoder', class {
        static isConfigSupported = isConfigSupported;
      });

      const result = await exportAudio(makeAudioBuffer(1, 10), 'wav');

      expect(result.format).toBe('wav');
      expect(result.fallbackReason).toBeNull();
      expect(result.blob.type).toBe('audio/wav');
      expect(isConfigSupported).not.toHaveBeenCalled();
    });

    it('默认格式是 wav', async () => {
      const result = await exportAudio(makeAudioBuffer(1, 10));

      expect(result.format).toBe('wav');
      expect(result.fallbackReason).toBeNull();
    });

    it('MP3 不受支持时降级为 WAV 并说明原因', async () => {
      vi.stubGlobal(
        'AudioEncoder',
        class {
          static async isConfigSupported(): Promise<{ supported: boolean }> {
            return { supported: false };
          }
        },
      );

      const result = await exportAudio(makeAudioBuffer(1, 10), 'mp3');

      expect(result.format).toBe('wav');
      expect(result.blob.type).toBe('audio/wav');
      expect(result.fallbackReason).toContain('MP3');
    });

    it('AAC 不受支持时降级为 WAV 并说明原因', async () => {
      vi.stubGlobal(
        'AudioEncoder',
        class {
          static async isConfigSupported(): Promise<{ supported: boolean }> {
            return { supported: false };
          }
        },
      );

      const result = await exportAudio(makeAudioBuffer(1, 10), 'aac');

      expect(result.format).toBe('wav');
      expect(result.blob.type).toBe('audio/wav');
      expect(result.fallbackReason).toContain('AAC');
    });

    it('没有 AudioEncoder 时降级为 WAV 并说明原因', async () => {
      vi.stubGlobal('AudioEncoder', undefined);

      const result = await exportAudio(makeAudioBuffer(1, 10), 'mp3');

      expect(result.format).toBe('wav');
      expect(result.fallbackReason).toContain('MP3');
    });

    it('能力探测抛异常时按「不支持」处理（不向外抛错）', async () => {
      vi.stubGlobal(
        'AudioEncoder',
        class {
          static async isConfigSupported(): Promise<{ supported: boolean }> {
            throw new Error('boom');
          }
        },
      );

      const result = await exportAudio(makeAudioBuffer(1, 10), 'mp3');

      expect(result.format).toBe('wav');
      expect(result.fallbackReason).toContain('MP3');
    });

    it('MP3 探测使用 mp3 codec 与混音总线的采样率 / 声道数', async () => {
      const isConfigSupported = vi.fn(async () => ({ supported: false }));
      vi.stubGlobal('AudioEncoder', class {
        static isConfigSupported = isConfigSupported;
      });

      await exportAudio(makeAudioBuffer(2, 10, 44_100), 'mp3');

      expect(isConfigSupported).toHaveBeenCalledWith({
        codec: 'mp3',
        sampleRate: 44_100,
        numberOfChannels: 2,
      });
    });

    it('AAC 探测使用 mp4a.40.2 codec', async () => {
      const isConfigSupported = vi.fn(async () => ({ supported: false }));
      vi.stubGlobal('AudioEncoder', class {
        static isConfigSupported = isConfigSupported;
      });

      await exportAudio(makeAudioBuffer(1, 10), 'aac');

      expect(isConfigSupported).toHaveBeenCalledWith({
        codec: 'mp4a.40.2',
        sampleRate: 48_000,
        numberOfChannels: 1,
      });
    });

    it('降级后仍产出可用的 WAV 字节', async () => {
      vi.stubGlobal('AudioEncoder', undefined);

      const result = await exportAudio(makeAudioBuffer(1, 10), 'mp3');

      const bytes = await blobBytes(result.blob);
      expect(readAscii(bytes, 0, 4)).toBe('RIFF');
      expect(readAscii(bytes, 8, 4)).toBe('WAVE');
    });

    it('三种格式的返回结构一致，且降级原因只在降级时出现', async () => {
      const formats: AudioExportFormat[] = ['wav', 'mp3', 'aac'];
      vi.stubGlobal('AudioEncoder', undefined);

      for (const format of formats) {
        const result = await exportAudio(makeAudioBuffer(1, 10), format);
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.blob.type).toBe('audio/wav');
        expect(result.format).toBe('wav');
        if (format === 'wav') {
          // 本来就是 WAV，不算降级
          expect(result.fallbackReason).toBeNull();
        } else {
          expect(typeof result.fallbackReason).toBe('string');
          expect(result.fallbackReason).toContain(format === 'mp3' ? 'MP3' : 'AAC');
        }
      }
    });
  });
});
