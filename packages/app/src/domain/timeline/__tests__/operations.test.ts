/**
 * 时间线领域运算测试：不变式与边界（FR-013 ~ FR-022）。
 */

import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDoc } from '@clipcut/shared-types';
import { deserialize } from '../../project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import {
  addClip,
  deleteClip,
  duplicateClip,
  IncompatibleTrackError,
  moveClip,
  NotSplittableError,
  removeTrack,
  setClipProperty,
  setClipSpeed,
  splitClip,
  trimClip,
  type OperationContext,
} from '../operations.js';
import { assertClipInvariants, fixClipDuration } from '../index.js';

/** 构造测试上下文。 */
function makeContext(doc: ProjectDoc): OperationContext {
  return { doc, assets: doc.assets };
}

/** 取得素材。 */
function asset(doc: ProjectDoc, id: string): Asset {
  const found = doc.assets[id];
  if (!found) throw new Error(`素材不存在：${id}`);
  return found;
}

/** 遍历所有 clip 校验不变式。 */
function assertAllInvariants(doc: ProjectDoc): void {
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      assertClipInvariants(clip, clip.assetId ? doc.assets[clip.assetId] : undefined);
    }
  }
}

describe('domain/timeline/operations', () => {
  it('新增 clip 后不变式成立', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const context = makeContext(doc);
    const result = addClip(context, {
      assetId: 'asset_full01',
      trackId: 'track_full_v2',
      startMs: 0,
      inMs: 1000,
      outMs: 6000,
    });

    const clip = result.doc.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === result.selectedClipId);
    expect(clip).toBeDefined();
    expect(clip?.durationMs).toBe(5000);
    expect(clip?.durationMs).toBe(Math.round((6000 - 1000) / 1));
    assertAllInvariants(result.doc);
  });

  it('图片素材默认 5s 时长', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = addClip(makeContext(doc), {
      assetId: 'asset_full03',
      trackId: 'track_full_v2',
      startMs: 0,
      inMs: 0,
    });
    const clip = result.doc.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === result.selectedClipId);
    expect(clip?.durationMs).toBe(5000);
  });

  it('视频素材不能拖到音频轨（跨类型禁止）', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    expect(() =>
      addClip(makeContext(doc), {
        assetId: 'asset_full01',
        trackId: 'track_full_a1',
        startMs: 0,
        inMs: 0,
        outMs: 1000,
      }),
    ).toThrowError(IncompatibleTrackError);
  });

  it('音频素材不能拖到视频轨', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    expect(() =>
      addClip(makeContext(doc), {
        assetId: 'asset_full02',
        trackId: 'track_full_v1',
        startMs: 0,
        inMs: 0,
        outMs: 1000,
      }),
    ).toThrowError(IncompatibleTrackError);
  });

  it('裁剪越界被钳制且不小于 100ms', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const context = makeContext(doc);
    const media = asset(doc, 'asset_full01');

    const tooLate = trimClip(context, 'clip_full_c1', 'out', media.durationMs + 10_000);
    const outClip = tooLate.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1');
    expect(outClip?.outMs).toBeLessThanOrEqual(media.durationMs);

    const tooEarly = trimClip(context, 'clip_full_c1', 'in', -500);
    const inClip = tooEarly.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1');
    expect(inClip?.inMs).toBe(0);

    // 裁剪到只剩 100ms（最小时长）——合法
    const minimal = trimClip(context, 'clip_full_c1', 'in', 13_000);
    const minimalClip = minimal.doc.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === 'clip_full_c1');
    expect(minimalClip?.durationMs).toBe(100);
    assertAllInvariants(tooLate.doc);
    assertAllInvariants(tooEarly.doc);
  });

  it('分割产生两段且共享素材引用', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = splitClip(makeContext(doc), 'clip_full_c1', 4000);
    const clips = result.doc.tracks.flatMap((track) => track.clips);
    const right = clips.find((clip) => clip.id === result.selectedClipId);
    const left = clips.find((clip) => clip.id !== 'clip_full_c1' && clip.id !== right?.id);

    expect(left?.assetId).toBe('asset_full01');
    expect(right?.assetId).toBe('asset_full01');
    expect((left?.durationMs ?? 0) + (right?.durationMs ?? 0)).toBe(12_000);
    expect(right?.inMs).toBe(left?.outMs);
    assertAllInvariants(result.doc);
  });

  it('分割点在首尾 1 帧内时抛错', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const context = makeContext(doc);
    expect(() => splitClip(context, 'clip_full_c1', 0)).toThrowError(NotSplittableError);
    expect(() => splitClip(context, 'clip_full_c1', 12_000)).toThrowError(NotSplittableError);
  });

  it('变速：speed 1 → 2 时 durationMs 减半、in/out 不变', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = setClipSpeed(makeContext(doc), 'clip_full_c1', 2);
    const clip = result.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1');

    expect(clip?.inMs).toBe(1000);
    expect(clip?.outMs).toBe(13_000);
    expect(clip?.durationMs).toBe(6000);
    expect(clip?.durationMs).toBe(Math.round((13_000 - 1000) / 2));
    assertAllInvariants(result.doc);
  });

  it('移动 clip 改变 startMs', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = moveClip(makeContext(doc), 'clip_full_c1', 'track_full_v1', 3000);
    const clip = result.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1');
    expect(clip?.startMs).toBe(3000);
  });

  it('删除与复制 clip', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const context = makeContext(doc);

    const duplicated = duplicateClip(context, 'clip_full_c1', 'track_full_v2', 5000);
    const target = duplicated.doc.tracks.find((t) => t.id === 'track_full_v2');
    expect(target?.clips).toHaveLength(1);
    expect(target?.clips[0]?.id).not.toBe('clip_full_c1');
    expect(target?.clips[0]?.inMs).toBe(1000);
    expect(target?.clips[0]?.outMs).toBe(13_000);
    expect(target?.clips[0]?.speed).toBe(1);

    const removed = deleteClip(context, 'clip_full_c1');
    const after = removed.doc.tracks.flatMap((t) => t.clips).filter((c) => c.id === 'clip_full_c1');
    expect(after).toHaveLength(0);
  });

  it('setClipProperty 只接受白名单路径', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const context = makeContext(doc);

    const updated = setClipProperty(context, 'clip_full_c1', 'audio.gain', 0.5);
    const clip = updated.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1');
    expect(clip?.audio.gain).toBe(0.5);

    expect(() => setClipProperty(context, 'clip_full_c1', 'durationMs', 1)).toThrow();
  });

  it('删除轨道会连带删除其 clip', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = removeTrack(makeContext(doc), 'track_full_a1');
    expect(result.doc.tracks.some((track) => track.id === 'track_full_a1')).toBe(false);
    expect(result.doc.tracks.flatMap((t) => t.clips).some((c) => c.id === 'clip_full_c3')).toBe(false);
  });

  it('fixClipDuration 重算时长', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1');
    expect(clip).toBeDefined();
    if (!clip) return;
    const fixed = fixClipDuration({ ...clip, speed: 2 });
    expect(fixed.durationMs).toBe(Math.round((clip.outMs - clip.inMs) / 2));
  });
});
