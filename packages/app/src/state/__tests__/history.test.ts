/**
 * 撤销 / 重做测试（FR-059）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore.js';
import { useHistoryStore } from '../historyStore.js';
import { useUiStore } from '../uiStore.js';
import { deserialize } from '../../domain/project/deserialize.js';
import { readFixtureJson } from '../../test/fixtures.js';
import { usePlaybackStore } from '../playbackStore.js';
import { setClipProperty, splitSelectedClip, undo, redo } from '../actions.js';

/** 重置全部 store。 */
function resetStores(): void {
  const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
  useProjectStore.getState().setDoc(doc, { markDirty: false });
  useHistoryStore.getState().reset();
  useUiStore.getState().setSelectedClipIds([]);
}

describe('state/history', () => {
  beforeEach(() => {
    resetStores();
  });

  it('连续 60 次编辑后连续撤销 60 次，状态完全回到初始', () => {
    const initial = structuredClone(useProjectStore.getState().doc);

    for (let i = 0; i < 60; i += 1) {
      const result = setClipProperty('clip_full_c1', 'audio.gain', 0.5 + i * 0.01);
      expect(result.ok).toBe(true);
    }
    expect(useHistoryStore.getState().past.length).toBe(60);

    for (let i = 0; i < 60; i += 1) {
      const result = undo();
      expect(result.ok).toBe(true);
    }

    expect(useProjectStore.getState().doc).toEqual(initial);
    expect(useHistoryStore.getState().past.length).toBe(0);
    expect(useHistoryStore.getState().future.length).toBe(60);
  });

  it('重做可以恢复被撤销的操作', () => {
    const initial = structuredClone(useProjectStore.getState().doc);
    setClipProperty('clip_full_c1', 'audio.gain', 0.25);
    expect(useProjectStore.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1')?.audio.gain).toBe(0.25);

    undo();
    expect(useProjectStore.getState().doc).toEqual(initial);

    redo();
    expect(
      useProjectStore.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c1')?.audio.gain,
    ).toBe(0.25);
  });

  it('一次拖拽（一次 moveClip）只产生一条历史记录', () => {
    setClipProperty('clip_full_c1', 'audio.gain', 0.5);
    expect(useHistoryStore.getState().past.length).toBe(1);
  });

  it('分割动作同样只产生一条历史记录', () => {
    useUiStore.getState().setSelectedClipIds(['clip_full_c1']);
    usePlaybackStore.getState().setCurrentTime(4000);
    const result = splitSelectedClip();
    expect(result.ok).toBe(true);
    expect(useHistoryStore.getState().past.length).toBe(1);
  });

  it('历史栈上限为 100 步', () => {
    for (let i = 0; i < 120; i += 1) {
      setClipProperty('clip_full_c1', 'audio.gain', (i % 100) / 100);
    }
    expect(useHistoryStore.getState().past.length).toBeLessThanOrEqual(100);
  });

  it('新操作会清空重做栈', () => {
    setClipProperty('clip_full_c1', 'audio.gain', 0.5);
    undo();
    expect(useHistoryStore.getState().future.length).toBe(1);
    setClipProperty('clip_full_c1', 'audio.gain', 0.75);
    expect(useHistoryStore.getState().future.length).toBe(0);
  });

  it('保存后 reset 清空撤销栈', () => {
    setClipProperty('clip_full_c1', 'audio.gain', 0.5);
    useHistoryStore.getState().reset();
    expect(useHistoryStore.getState().past.length).toBe(0);
    expect(useHistoryStore.getState().future.length).toBe(0);
  });
});
