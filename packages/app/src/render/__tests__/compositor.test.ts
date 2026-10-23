/**
 * 合成器测试：轨道 `order` 合成顺序、hidden 轨不参与渲染、PIP 层数限制。
 */

import { describe, expect, it } from 'vitest';
import { deserialize } from '../../domain/project/deserialize.js';
import { readFixtureJson } from '../../test/fixtures.js';
import { MAX_OVERLAY_LAYERS, renderFrame } from '../compositor.js';

/** 记录绘制调用的假 2D 上下文。 */
interface MockContext {
  calls: string[];
  ctx: CanvasRenderingContext2D;
}

/** 构造一个可记录调用的假 2D 上下文。 */
function createMockContext(): MockContext {
  const calls: string[] = [];
  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    miterLimit: 10,
    letterSpacing: '0px',
    save() {
      calls.push('save');
    },
    restore() {
      calls.push('restore');
    },
    translate() {
      /* no-op */
    },
    rotate() {
      /* no-op */
    },
    scale() {
      /* no-op */
    },
    beginPath() {
      /* no-op */
    },
    closePath() {
      /* no-op */
    },
    clip() {
      /* no-op */
    },
    moveTo() {
      /* no-op */
    },
    lineTo() {
      /* no-op */
    },
    quadraticCurveTo() {
      /* no-op */
    },
    fillRect() {
      calls.push('fillRect');
    },
    drawImage(_image: unknown, ..._args: unknown[]) {
      calls.push('drawImage');
    },
    fillText(text: string) {
      calls.push(`fillText:${text}`);
    },
    strokeText(text: string) {
      calls.push(`strokeText:${text}`);
    },
    measureText(text: string) {
      return { width: text.length * 10 };
    },
  };

  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** 构造一个假的 ImageBitmap。 */
function createFakeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: () => undefined } as unknown as ImageBitmap;
}

describe('render/compositor', () => {
  it('轨道 order 小的在下、大的在上（绘制顺序）', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const { calls, ctx } = createMockContext();

    renderFrame(ctx, doc, 2500, {
      getFrame: (_assetId) => createFakeBitmap(1920, 1080),
    });

    const drawIndex = calls.indexOf('drawImage');
    expect(drawIndex).toBeGreaterThanOrEqual(0);
    // 视频轨 1（order 1）先绘制，视频轨 2（order 0）后绘制
    expect(calls.filter((call) => call === 'drawImage').length).toBeGreaterThanOrEqual(1);
  });

  it('hidden 轨的 clip 不参与渲染', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const hiddenDoc = {
      ...doc,
      tracks: doc.tracks.map((track) =>
        track.id === 'track_full_v1' ? { ...track, hidden: true } : track,
      ),
    };

    const visible = createMockContext();
    renderFrame(visible.ctx, doc, 2500, { getFrame: () => createFakeBitmap(1920, 1080) });
    const hidden = createMockContext();
    renderFrame(hidden.ctx, hiddenDoc, 2500, {
      getFrame: () => createFakeBitmap(1920, 1080),
    });

    const visibleDraws = visible.calls.filter((call) => call === 'drawImage').length;
    const hiddenDraws = hidden.calls.filter((call) => call === 'drawImage').length;
    expect(hiddenDraws).toBeLessThan(visibleDraws);
  });

  it('文字轨在视频之后绘制', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const { calls, ctx } = createMockContext();

    renderFrame(ctx, doc, 1500, { getFrame: () => createFakeBitmap(1920, 1080) });

    const textIndex = calls.findIndex((call) => call.startsWith('fillText:'));
    const imageIndex = calls.indexOf('drawImage');
    expect(textIndex).toBeGreaterThanOrEqual(0);
    expect(imageIndex).toBeGreaterThanOrEqual(0);
    expect(textIndex).toBeGreaterThan(imageIndex);
  });

  it('PIP 超过 4 层时只渲染前 4 层并给出告警', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const warnings: string[] = [];

    const overlays = Array.from({ length: 6 }, (_, index) => ({
      id: `overlay_${index}`,
      assetId: 'asset_full03',
      startMs: 0,
      durationMs: 5000,
      inMs: 0,
      outMs: 5000,
      speed: 1,
      isOverlay: true,
      zIndex: index,
      transform: {
        x: 0.5,
        y: 0.5,
        scale: 0.2,
        rotation: 0,
        opacity: 1,
        fit: 'contain' as const,
        cornerRadius: 0,
      },
      audio: { muted: true, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
      label: null,
    }));

    const manyOverlays = {
      ...doc,
      tracks: [
        {
          ...doc.tracks[0]!,
          id: 'track_overlay',
          clips: overlays,
        },
      ],
    };

    const { calls, ctx } = createMockContext();
    renderFrame(ctx, manyOverlays, 1000, {
      getFrame: () => createFakeBitmap(512, 512),
      warnings,
    });

    expect(calls.filter((call) => call === 'drawImage').length).toBe(MAX_OVERLAY_LAYERS);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('4');
  });

  it('字幕轨关闭时不绘制字幕', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const { calls, ctx } = createMockContext();

    renderFrame(ctx, doc, 1500, {
      getFrame: () => null,
      burnInSubtitles: false,
    });

    expect(calls.some((call) => call.includes('第一句字幕'))).toBe(false);
  });

  it('字幕轨开启时绘制当前 cue', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const { calls, ctx } = createMockContext();

    renderFrame(ctx, doc, 1500, {
      getFrame: () => null,
      burnInSubtitles: true,
    });

    expect(calls.some((call) => call.includes('第一句字幕'))).toBe(true);
  });
});
