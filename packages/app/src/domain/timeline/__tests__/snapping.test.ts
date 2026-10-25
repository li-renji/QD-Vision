/**
 * 吸附阈值与候选点选择测试（FR-021）。
 */

import { describe, expect, it } from 'vitest';
import type { ProjectDoc, Track } from '@clipcut/shared-types';
import { deserialize } from '../../project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import {
  collectSecondTicks,
  collectSnapCandidates,
  computeDropStartMs,
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

/** 构造只含吸附所需字段的轨道（纯函数只读 startMs / durationMs）。 */
function snapTrack(
  id: string,
  order: number,
  clips: ReadonlyArray<{ id: string; startMs: number; durationMs: number }>,
): Track {
  return {
    id,
    type: 'video',
    name: id,
    order,
    muted: false,
    hidden: false,
    locked: false,
    height: 60,
    clips: clips.map((clip) => ({ ...clip })),
  } as unknown as Track;
}

function docOf(tracks: Track[]): ProjectDoc {
  return { tracks } as unknown as ProjectDoc;
}

describe('computeDropStartMs（拖素材入轨吸附规则）', () => {
  const PX = 40; // 40px/s → 8px ≈ 200ms 阈值

  it('规则1：首条轨道的第一段 → 强制对齐 0s（无视落点）', () => {
    const doc = docOf([snapTrack('t1', 0, [])]);
    expect(computeDropStartMs(doc, 't1', 8000, 0, PX)).toBe(0);
    expect(computeDropStartMs(doc, 't1', 0, 0, PX)).toBe(0);
  });

  it('规则3：非首条轨道且为空 → 落点自由', () => {
    const doc = docOf([snapTrack('t1', 0, []), snapTrack('t2', 1, [])]);
    expect(computeDropStartMs(doc, 't2', 4321, 0, PX)).toBe(4321);
  });

  it('规则2：同轨已有片段 → 吸附到最近片段边界（首尾相接）', () => {
    const doc = docOf([snapTrack('t1', 0, [{ id: 'c1', startMs: 0, durationMs: 3000 }])]);
    expect(computeDropStartMs(doc, 't1', 3100, 0, PX)).toBe(3000);
    expect(computeDropStartMs(doc, 't1', 2900, 0, PX)).toBe(3000);
  });

  it('规则2：超出阈值的落点保持原值', () => {
    const doc = docOf([snapTrack('t1', 0, [{ id: 'c1', startMs: 0, durationMs: 3000 }])]);
    expect(computeDropStartMs(doc, 't1', 5000, 0, PX)).toBe(5000);
  });

  it('规则3：不同轨道不互相牵引（第2轨不吸附到第1轨的片段）', () => {
    const doc = docOf([
      snapTrack('t1', 0, [{ id: 'c1', startMs: 0, durationMs: 3000 }]),
      snapTrack('t2', 1, []),
    ]);
    expect(computeDropStartMs(doc, 't2', 5000, 0, PX)).toBe(5000);
  });

  it('播放头也是同轨吸附候选点', () => {
    const doc = docOf([snapTrack('t1', 0, [{ id: 'c1', startMs: 0, durationMs: 3000 }])]);
    expect(computeDropStartMs(doc, 't1', 6100, 6000, PX)).toBe(6000);
  });

  it('负数落点被钳到 0', () => {
    const doc = docOf([snapTrack('t1', 0, []), snapTrack('t2', 1, [])]);
    expect(computeDropStartMs(doc, 't2', -500, 0, PX)).toBe(0);
  });
});
