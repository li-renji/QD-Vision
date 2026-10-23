/**
 * 吸附阈值与候选点选择测试（FR-021）。
 */

import { describe, expect, it } from 'vitest';
import { deserialize } from '../../project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import {
  collectSecondTicks,
  collectSnapCandidates,
  DEFAULT_SNAP_THRESHOLD_PX,
  findSnap,
} from '../index.js';

describe('domain/timeline/snapping', () => {
  it('收集播放头、clip 首尾作为候选点', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const candidates = collectSnapCandidates(doc, [], 2500);

    expect(candidates.some((c) => c.kind === 'playhead' && c.ms === 2500)).toBe(true);
    expect(candidates.some((c) => c.kind === 'clip-start' && c.ms === 0)).toBe(true);
    expect(candidates.some((c) => c.kind === 'clip-end' && c.ms === 12_000)).toBe(true);
  });

  it('排除正在拖拽的 clip 自身的首尾', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const candidates = collectSnapCandidates(doc, ['clip_full_c1'], 0);
    expect(candidates.some((c) => c.clipId === 'clip_full_c1')).toBe(false);
  });

  it('8px 阈值内命中，超出则不命中', () => {
    const candidates = [
      { ms: 1000, kind: 'clip-start' as const, clipId: 'a' },
      { ms: 5000, kind: 'clip-end' as const, clipId: 'b' },
    ];

    // 40px/s 时 8px = 200ms
    const hit = findSnap(1150, candidates, 40, DEFAULT_SNAP_THRESHOLD_PX);
    expect(hit).not.toBeNull();
    expect(hit?.ms).toBe(1000);

    const miss = findSnap(1500, candidates, 40, DEFAULT_SNAP_THRESHOLD_PX);
    expect(miss).toBeNull();
  });

  it('命中时选择距离最近��候选点', () => {
    const candidates = [
      { ms: 1000, kind: 'clip-start' as const, clipId: 'a' },
      { ms: 1200, kind: 'clip-end' as const, clipId: 'b' },
    ];
    const hit = findSnap(1150, candidates, 40, 8);
    expect(hit?.ms).toBe(1200);
  });

  it('整秒刻度候选点', () => {
    const ticks = collectSecondTicks(0, 5000);
    expect(ticks.map((t) => t.ms)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(ticks.every((t) => t.kind === 'second')).toBe(true);
  });

  it('缩放为 0 时不吸附', () => {
    expect(findSnap(1000, [{ ms: 1000, kind: 'second', clipId: null }], 0)).toBeNull();
  });
});
