/**
 * 编辑动作测试：每条动作产生**单条**历史记录。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore.js';
import { useHistoryStore } from '../historyStore.js';
import { useUiStore } from '../uiStore.js';
import { deserialize } from '../../domain/project/deserialize.js';
import { readFixtureJson } from '../../test/fixtures.js';
import {
  addClip,
  addTrack,
  copySelectedClips,
  deleteClip,
  duplicateClip,
  moveClip,
  pasteClips,
  setClipProperty,
  setClipSpeed,
  setTrackFlags,
  splitClip,
  trimClip,
} from '../actions.js';

/** 重置全部 store。 */
function resetStores(): void {
  const doc = deserialize(readFixtureJson('full.clipcut.json'));
  useProjectStore.getState().setDoc(doc, { markDirty: false });
  useHistoryStore.getState().reset();
  useUiStore.getState().setSelectedClipIds([]);
  useUiStore.getState().setSelectedTrackId('track_full_v1');
}

describe('state/actions', () => {
  beforeEach(() => {
    resetStores();
  });

  it('每个动作恰好产生一条历史记录', () => {
    const cases: Array<[string, () => unknown]> = [
      ['setClipProperty', () => setClipProperty('clip_full_c1', 'audio.gain', 0.5)],
      ['setClipSpeed', () => setClipSpeed('clip_full_c1', 2)],
      ['moveClip', () => moveClip('clip_full_c1', 'track_full_v1', 2000)],
      ['trimClip', () => trimClip('clip_full_c1', 'out', 10_000)],
      ['splitClip', () => splitClip('clip_full_c1', 4000)],
      ['deleteClip', () => deleteClip('clip_full_c1')],
      ['duplicateClip', () => duplicateClip('clip_full_c1', 'track_full_v2', 0)],
      ['addTrack', () => addTrack({ type: 'video', name: '新轨道' })],
      ['setTrackFlags', () => setTrackFlags('track_full_v1', { muted: true })],
      [
        'addClip',
        () => addClip({ assetId: 'asset_full01', trackId: 'track_full_v2', startMs: 0, inMs: 0, outMs: 1000 }),
      ],
    ];

    for (const [name, action] of cases) {
      resetStores();
      useHistoryStore.getState().reset();
      const result = action() as { ok: boolean };
      expect(result.ok, `动作 ${name} 执行失败`).toBe(true);
      expect(useHistoryStore.getState().past.length, `动作 ${name} 产生了多条历史记录`).toBe(1);
    }
  });

  it('失败的动作不产生历史记录', () => {
    const result = setClipProperty('clip_full_c1', 'durationMs', 1);
    expect(result.ok).toBe(false);
    expect(useHistoryStore.getState().past.length).toBe(0);
  });

  it('复制 / 粘贴保持 in/out/speed 不变', () => {
    useUiStore.getState().setSelectedClipIds(['clip_full_c1']);
    const copied = copySelectedClips();
    expect(copied.ok).toBe(true);

    const before = useProjectStore
      .getState()
      .doc.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === 'clip_full_c1');
    expect(before).toBeDefined();

    const pasted = pasteClips();
    expect(pasted.ok).toBe(true);

    const after = useProjectStore
      .getState()
      .doc.tracks.flatMap((t) => t.clips)
      .filter((c) => c.id !== 'clip_full_c1' && c.inMs === before?.inMs && c.outMs === before?.outMs);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0]?.speed).toBe(before?.speed);
  });

  it('动作执行后 doc 被标记为脏', () => {
    useProjectStore.getState().setDoc(useProjectStore.getState().doc, { markDirty: false });
    setClipProperty('clip_full_c1', 'audio.gain', 0.5);
    expect(useProjectStore.getState().dirty).toBe(true);
  });
});
