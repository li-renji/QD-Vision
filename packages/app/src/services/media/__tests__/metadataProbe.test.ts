/**
 * 元数据解析失败降级为 `duration = 0`（FR-007③）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeAudio, probeImage, probeMedia, probeVideo } from '../metadataProbe.js';

describe('services/media/metadataProbe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('视频解析失败时降级为 duration=0 且 playable=false', async () => {
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = originalCreate(tag);
      if (tag === 'video') {
        // 模拟加载失败
        window.setTimeout(() => {
          element.dispatchEvent(new Event('error'));
        }, 0);
      }
      return element;
    });

    const result = await probeVideo(new Blob(['x'], { type: 'video/mp4' }));
    expect(result.durationMs).toBe(0);
    expect(result.playable).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('图片解析失败时降级', async () => {
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = originalCreate(tag);
      if (tag === 'img') {
        window.setTimeout(() => {
          element.dispatchEvent(new Event('error'));
        }, 0);
      }
      return element;
    });

    const result = await probeImage(new Blob(['x'], { type: 'image/png' }));
    expect(result.durationMs).toBe(0);
    expect(result.playable).toBe(false);
  });

  it('音频解析失败时降级且不抛异常', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData(): Promise<never> {
          return Promise.reject(new Error('decode failed'));
        }

        close(): Promise<void> {
          return Promise.resolve();
        }
      },
    );

    const result = await probeAudio(new Blob(['x'], { type: 'audio/mpeg' }));
    expect(result.durationMs).toBe(0);
    expect(result.playable).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('probeMedia 按类型分派', async () => {
    const result = await probeMedia(new Blob(['x'], { type: 'image/png' }), 'image');
    expect(result).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
  });
});
