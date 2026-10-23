/**
 * 派生查询测试（selectors）。
 */

import { describe, expect, it } from 'vitest';
import { deserialize } from '../../project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import {
  clipAtTimeOnTrack,
  clipEndMs,
  clipsAtTime,
  findClip,
  findTrack,
  orderedTracks,
  overlayClipsAtTime,
  textTracks,
  trackDurationMs,
  visibleVideoTracks,
} from '../index.js';

describe('domain/timeline/selectors', () => {
  it('orderedTracks 按 order 升序', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const orders = orderedTracks(doc).map((track) => track.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('visibleVideoTracks 排除 hidden 轨', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const hiddenDoc = {
      ...doc,
      tracks: doc.tracks.map((track) =>
        track.id === 'track_full_v1' ? { ...track, hidden: true } : track,
      ),
    };

    const visible = visibleVideoTracks(hiddenDoc).map((track) => track.id);
    expect(visible).not.toContain('track_full_v1');
    expect(visibleVideoTracks(doc).map((track) => track.id)).toContain('track_full_v1');
  });

  it('textTracks 只返回文字轨', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    expect(textTracks(doc).every((track) => track.type === 'text')).toBe(true);
  });

  it('findClip / findTrack 定位', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const found = findClip(doc, 'clip_full_c1');
    expect(found?.clip.id).toBe('clip_full_c1');
    expect(found?.track.id).toBe('track_full_v1');
    expect(findClip(doc, 'nope')).toBeNull();
    expect(findTrack(doc, 'track_full_a1')?.type).toBe('audio');
    expect(findTrack(doc, 'nope')).toBeNull();
  });

  it('clipsAtTime 返回该时刻所有活动 clip', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const clips = clipsAtTime(doc, 2500);
    expect(clips.map((clip) => clip.id).sort()).toEqual([
      'clip_full_c1',
      'clip_full_c2',
      'clip_full_c3',
      'clip_full_c4',
    ]);
  });

  it('clipsAtTime 排除 hidden 轨', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const hiddenDoc = {
      ...doc,
      tracks: doc.tracks.map((track) =>
        track.id === 'track_full_v1' ? { ...track, hidden: true } : track,
      ),
    };
    expect(clipsAtTime(hiddenDoc, 2500).map((clip) => clip.id)).not.toContain('clip_full_c1');
  });

  it('overlayClipsAtTime 按 zIndex 升序', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const overlays = overlayClipsAtTime(doc, 2500);
    expect(overlays.length).toBeGreaterThan(0);
    expect(overlays.every((clip) => clip.isOverlay)).toBe(true);
    const zIndexes = overlays.map((clip) => clip.zIndex);
    expect([...zIndexes].sort((a, b) => a - b)).toEqual(zIndexes);
  });

  it('clipEndMs / trackDurationMs', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1');
    expect(clip).toBeDefined();
    expect(clipEndMs(clip!)).toBe(12_000);

    const track = doc.tracks.find((t) => t.id === 'track_full_a1');
    expect(track).toBeDefined();
    expect(trackDurationMs(track!)).toBe(30_000);
  });

  it('clipAtTimeOnTrack 定位轨道上的 clip', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const track = doc.tracks.find((t) => t.id === 'track_full_v1');
    expect(track).toBeDefined();
    expect(clipAtTimeOnTrack(track!, 2500)?.id).toBe('clip_full_c1');
    expect(clipAtTimeOnTrack(track!, 99_000)).toBeNull();
  });
});
