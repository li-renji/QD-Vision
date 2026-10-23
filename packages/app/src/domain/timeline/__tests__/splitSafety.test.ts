/**
 * 分割危险区判定与结构化拒绝错误（FR-018③）。
 *
 * 核心诉求：**能在入口拦住的，不要留到管线里静默失败**。
 */

import { describe, expect, it } from 'vitest';
import type { Clip } from '@clipcut/shared-types';
import { deserialize } from '../../project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import { evaluateSplitAt, evaluateSplitAtTime, MIN_CLIP_DURATION_MS } from '../index.js';
import { NotSplittableError, splitClip } from '../operations.js';

/** 构造一个 clip。 */
function makeClip(partial: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    startMs: 0,
    durationMs: 5000,
    inMs: 0,
    outMs: 5000,
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

describe('FR-018③ · 分割危险区判定', () => {
  const frameMs = 1000 / 30;
  const minMs = MIN_CLIP_DURATION_MS;

  it('播放头在 clip 中部时可分割', () => {
    const zone = evaluateSplitAt(makeClip(), 2500, frameMs, minMs);
    expect(zone.blocked).toBe(false);
    expect(zone.action).toBe('none');
    expect(zone.leftMs).toBe(2500);
    expect(zone.rightMs).toBe(2500);
  });

  it('播放头距首端不足下限时被阻止，并建议右移', () => {
    const zone = evaluateSplitAt(makeClip(), 40, frameMs, minMs);
    expect(zone.blocked).toBe(true);
    expect(zone.action).toBe('move-right');
    expect(zone.leftMs).toBe(40);
    expect(zone.rightMs).toBe(4960);
  });

  it('播放头距尾端不足下限时被阻止，并建议左移', () => {
    const zone = evaluateSplitAt(makeClip(), 4960, frameMs, minMs);
    expect(zone.blocked).toBe(true);
    expect(zone.action).toBe('move-left');
    expect(zone.rightMs).toBe(40);
  });

  it('距边缘不足 1 帧也被阻止（即使两侧都够长）', () => {
    const zone = evaluateSplitAt(makeClip(), 10, frameMs, minMs);
    expect(zone.blocked).toBe(true);
  });

  it('给出可分割区间，便于 UI 提示用户移到哪', () => {
    const zone = evaluateSplitAt(makeClip(), 40, frameMs, minMs);
    expect(zone.minAtMs).toBe(minMs);
    expect(zone.maxAtMs).toBe(5000 - minMs);
  });

  it('evaluateSplitAtTime 自动定位命中 clip；无命中返回 null', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const inside = evaluateSplitAtTime(doc, 5000, frameMs, minMs);
    expect(inside).not.toBeNull();

    const outside = evaluateSplitAtTime(doc, 999_999, frameMs, minMs);
    expect(outside).toBeNull();
  });
});

describe('FR-018③ · 结构化拒绝错误', () => {
  it('分割失败时携带 left / right / min / frame', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const context = { doc, assets: doc.assets };

    try {
      // clip_full_c1: start 0, duration 12000 → 在 50ms 处分割，左侧仅 50ms
      splitClip(context, 'clip_full_c1', 50);
      throw new Error('本应抛出 NotSplittableError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotSplittableError);
      const details = error as NotSplittableError;
      expect(details.reason).toBe('too-short');
      expect(details.leftMs).toBe(50);
      expect(details.rightMs).toBe(11_950);
      expect(details.minMs).toBe(MIN_CLIP_DURATION_MS);
      expect(details.frameMs).toBeGreaterThan(0);
    }
  });

  it('距边缘不足 1 帧时 reason 为 frame-too-close', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const context = { doc, assets: doc.assets };

    try {
      splitClip(context, 'clip_full_c1', 5);
      throw new Error('本应抛出 NotSplittableError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotSplittableError);
      expect((error as NotSplittableError).reason).toBe('frame-too-close');
    }
  });

  it('错误信息本身仍可读（不依赖 i18n 也能定位问题）', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const context = { doc, assets: doc.assets };
    try {
      splitClip(context, 'clip_full_c1', 50);
    } catch (error) {
      expect((error as Error).message).toContain('50');
      expect((error as Error).message).toContain('11950');
    }
  });
});
