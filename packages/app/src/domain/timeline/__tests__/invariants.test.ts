/**
 * 不变式守卫测试。
 */

import { describe, expect, it } from 'vitest';
import type { Asset, Clip } from '@clipcut/shared-types';
import {
  assertAllClipInvariants,
  assertClipInvariants,
  assertFixSatisfiesAssert,
  ClipInvariantError,
  expectedDurationMs,
  fixClipDuration,
  isSpanLongEnough,
  MAX_CLIP_SPEED,
  MIN_CLIP_DURATION_MS,
  MIN_CLIP_SPEED,
  minSourceSpanMs,
} from '../index.js';

/** 构造一个 clip。 */
function makeClip(partial: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    startMs: 0,
    durationMs: 1000,
    inMs: 0,
    outMs: 1000,
    speed: 1,
    isOverlay: false,
    zIndex: 0,
    transform: {
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      opacity: 1,
      fit: 'contain',
      cornerRadius: 0,
    },
    audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
    label: null,
    ...partial,
  };
}

/** 构造一个素材。 */
function makeAsset(partial: Partial<Asset> = {}): Asset {
  return {
    id: 'asset_1',
    type: 'video',
    name: 'a.mp4',
    sourceType: 'local',
    mimeType: 'video/mp4',
    sizeBytes: 100,
    blobKey: 'blob:asset_1',
    proxyBlobKey: null,
    thumbnailBlobKey: null,
    waveform: null,
    durationMs: 5000,
    width: 1920,
    height: 1080,
    frameRate: 30,
    hasAudio: true,
    videoCodec: 'avc1.640028',
    playable: true,
    license: null,
    importedAt: '2026-10-23T00:00:00.000Z',
    ...partial,
  };
}

describe('domain/timeline/invariants', () => {
  it('常量符合规格', () => {
    expect(MIN_CLIP_DURATION_MS).toBe(100);
    expect(MIN_CLIP_SPEED).toBe(0.1);
    expect(MAX_CLIP_SPEED).toBe(100);
  });

  it('fixClipDuration 忠实按公式重算，**不做任何钳制**', () => {
    expect(fixClipDuration(makeClip({ speed: 2 })).durationMs).toBe(500);
    // 源区间 1000ms @ 100x → 10ms。fix 必须忠实算出 10，而不是钳到 100。
    // （QA BUG-01：早期实现在这里钳制，导致 fix 的产物被自己的 assert 判为违规。）
    expect(fixClipDuration(makeClip({ speed: 100 })).durationMs).toBe(10);
    expect(fixClipDuration(makeClip({ inMs: 0, outMs: 500, speed: 10 })).durationMs).toBe(50);
  });

  it('minSourceSpanMs 按 speed 反解源区间最小跨度', () => {
    expect(minSourceSpanMs(1)).toBe(100);
    expect(minSourceSpanMs(2)).toBe(200);
    expect(minSourceSpanMs(10)).toBe(1000);
    // 非法速度退化为 1
    expect(minSourceSpanMs(0)).toBe(100);
    expect(minSourceSpanMs(Number.NaN)).toBe(100);
  });

  it('isSpanLongEnough 判定源区间是否满足最小时长', () => {
    expect(isSpanLongEnough(0, 1000, 10)).toBe(true);
    expect(isSpanLongEnough(0, 500, 10)).toBe(false);
    expect(isSpanLongEnough(0, 100, 1)).toBe(true);
  });

  it('expectedDurationMs 是 fix 与 assert 的唯一公式来源', () => {
    const clip = makeClip({ inMs: 1000, outMs: 13_000, speed: 2 });
    expect(expectedDurationMs(clip)).toBe(6000);
    expect(fixClipDuration(clip).durationMs).toBe(expectedDurationMs(clip));
  });

  it('文字 clip（assetId = null）的时长独立于素材', () => {
    const textClip = makeClip({ assetId: null, inMs: 0, outMs: 0, durationMs: 3000 });
    expect(fixClipDuration(textClip).durationMs).toBe(3000);
  });

  it('assertClipInvariants 通过合法 clip', () => {
    expect(() => assertClipInvariants(makeClip(), makeAsset())).not.toThrow();
  });

  it('素材越界抛错', () => {
    expect(() => assertClipInvariants(makeClip({ outMs: 9999 }), makeAsset())).toThrowError(
      ClipInvariantError,
    );
    expect(() => assertClipInvariants(makeClip({ inMs: -1 }), makeAsset())).toThrowError(
      ClipInvariantError,
    );
  });

  it('小于最小时长抛错', () => {
    expect(() => assertClipInvariants(makeClip({ durationMs: 50 }), makeAsset())).toThrowError(
      ClipInvariantError,
    );
  });

  it('durationMs 与源区间不一致抛错', () => {
    expect(() => assertClipInvariants(makeClip({ durationMs: 999 }), makeAsset())).toThrowError(
      ClipInvariantError,
    );
  });

  it('图片素材不做源区间越界校验', () => {
    const imageAsset = makeAsset({ type: 'image', durationMs: 0 });
    expect(() =>
      assertClipInvariants(makeClip({ outMs: 5000, durationMs: 5000 }), imageAsset),
    ).not.toThrow();
  });

  it('assertAllClipInvariants 批量校验', () => {
    const assets = { asset_1: makeAsset() };
    expect(() => assertAllClipInvariants([makeClip()], assets)).not.toThrow();
    expect(() =>
      assertAllClipInvariants([makeClip({ durationMs: 1 })], assets),
    ).toThrowError(ClipInvariantError);
  });
});

describe('domain/timeline/invariants · fix 与 assert 的一致性契约', () => {
  /**
   * 回归守护（QA BUG-01）。
   *
   * 只要有人再把最小时长钳制写回 `fixClipDuration`，本用例立刻失败。
   */
  it('对任意合法 clip，fix 之后 assert 必然通过', () => {
    const speeds = [0.25, 0.5, 1, 1.5, 2, 4, 10];
    const spans = [100, 500, 1000, 5000, 12_000, 30_000];
    // 素材足够长，避免触发「素材越界」分支（本用例只关心时长不变式）
    const asset = makeAsset({ durationMs: 30_000 });

    for (const speed of speeds) {
      for (const span of spans) {
        const clip = makeClip({ inMs: 0, outMs: span, speed, durationMs: 0 });
        const fixed = fixClipDuration(clip);

        // fix 忠实按公式重算
        expect(fixed.durationMs).toBe(Math.round(span / speed));
        // 且 fix 的产物必然自洽（源区间合法时不触发最小时长分支）
        if (span / speed >= MIN_CLIP_DURATION_MS) {
          expect(() => assertClipInvariants(fixed, asset)).not.toThrow();
          expect(() => assertFixSatisfiesAssert(clip, asset)).not.toThrow();
        }
      }
    }
  });

  it('QA BUG-01 复现场景：setClipSpeed 目标态不再自相矛盾', () => {
    // 早期实现在 fix 里钳到 100ms，而 assert 期望 50ms → 两者互相否定。
    // 现在 fix 忠实算出 50；是否「允许」由操作层（minSourceSpanMs）决定，而不是靠矛盾的数据。
    const clip = makeClip({ inMs: 0, outMs: 500, speed: 1, durationMs: 500 });
    const fixed = fixClipDuration(clip);
    expect(fixed.durationMs).toBe(500);

    const sped = fixClipDuration({ ...clip, speed: 10 });
    expect(sped.durationMs).toBe(50); // 与公式一致，未被钳到 100
    expect(expectedDurationMs(sped)).toBe(50);
    // 该状态下 assert 会因「短于最小时长」而拒绝 —— 这是**正确**的显式拒绝，而非静默产出不一致数据。
    expect(() => assertClipInvariants(sped, makeAsset())).toThrowError(/小于最小 clip 时长/);
  });
});
