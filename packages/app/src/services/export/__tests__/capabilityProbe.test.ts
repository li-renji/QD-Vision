/**
 * 编码器能力矩阵生成测试（mock WebCodecs）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeCodecMatrix } from '../capabilityProbe.js';

/** 安装一个假的 VideoEncoder 构造器。 */
function stubVideoEncoder(supported: string[]): void {
  vi.stubGlobal(
    'VideoEncoder',
    class {
      static async isConfigSupported(config: { codec: string }): Promise<{ supported: boolean }> {
        return { supported: supported.includes(config.codec) };
      }
    },
  );
}

/** 安装一个假的 AudioEncoder 构造器。 */
function stubAudioEncoder(supported: string[]): void {
  vi.stubGlobal(
    'AudioEncoder',
    class {
      static async isConfigSupported(config: { codec: string }): Promise<{ supported: boolean }> {
        return { supported: supported.includes(config.codec) };
      }
    },
  );
}

describe('services/export/capabilityProbe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('没有 WebCodecs 时全部不可用', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    vi.stubGlobal('AudioEncoder', undefined);
    vi.stubGlobal('MediaRecorder', undefined);

    const matrix = await probeCodecMatrix();
    expect(matrix.video.h264.supported).toBe(false);
    expect(matrix.audio.aac.supported).toBe(false);
    expect(matrix.recorder.webm).toBe(false);
    expect(matrix.preferredExport.format).toBe('webm');
  });

  it('H.264 + AAC 可用时推荐 MP4', async () => {
    stubVideoEncoder(['avc1.640028']);
    stubAudioEncoder(['mp4a.40.2']);
    vi.stubGlobal('MediaRecorder', undefined);

    const matrix = await probeCodecMatrix();
    expect(matrix.video.h264.supported).toBe(true);
    expect(matrix.video.h264.codec).toBe('avc1.640028');
    expect(matrix.audio.aac.supported).toBe(true);
    expect(matrix.preferredExport.format).toBe('mp4');
    expect(matrix.preferredExport.audio).toBe('mp4a.40.2');
  });

  it('只有 VP9 时推荐 WebM', async () => {
    stubVideoEncoder(['vp09.00.10.08']);
    stubAudioEncoder(['opus']);
    vi.stubGlobal('MediaRecorder', undefined);

    const matrix = await probeCodecMatrix();
    expect(matrix.preferredExport.format).toBe('webm');
    expect(matrix.preferredExport.video).toBe('vp09.00.10.08');
  });

  it('MediaRecorder 可用时给出兜底提示', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    vi.stubGlobal('AudioEncoder', undefined);
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported(mimeType: string): boolean {
          return mimeType === 'video/webm;codecs=vp9,opus';
        }
      },
    );

    const matrix = await probeCodecMatrix();
    expect(matrix.recorder.webm).toBe(true);
    expect(matrix.recorder.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(matrix.preferredExport.reason).toContain('MediaRecorder');
  });
});
