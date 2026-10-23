/**
 * `meta.durationMs` 派生量刷新测试。
 *
 * ##背景 bug
 *
 * `meta.durationMs` 是 ARCHITECTURE §5.1 定义的**缓存派生量**，原本只在
 * `serialize()` / `deserialize()` 里重算，**编辑路径不刷新**。
 * 于是新建工程里加了 clip 之后它仍是 0，而全仓库有 6 处直接读它：
 *
 * - `App.tsx` / `TopToolbar.tsx` / `PreviewControls.tsx` / `selectors.ts`
 *   → 时间线总长显示为 0、`跳到结尾` 跳到 0
 * - `services/storage/db.ts` → 自动保存索引里的时长字段是错的
 * - **`domain/export/exportPlan.ts` → 导出的视频总时长是 0**（最严重）
 *
 * 修复：`projectStore` 在每次写入后统一重算（`withFreshDuration`）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../domain/project/factory.js';
import { computeProjectDuration } from '../../domain/project/duration.js';
import { buildExportPlan } from '../../domain/export/exportPlan.js';
import { useHistoryStore } from '../historyStore.js';
import { useProjectStore } from '../projectStore.js';
import { addClip, deleteClip, setClipProperty } from '../actions.js';

/** 重置到空白工程。 */
function reset(): void {
  useProjectStore.getState().setDoc(createEmptyProject('测试'), { markDirty: false });
  useHistoryStore.getState().reset();
}

/** 构造一个最小可用素材。 */
const ASSET = {
  id: 'asset_dur',
  type: 'video' as const,
  name: 'a.mp4',
  sourceType: 'local' as const,
  mimeType: 'video/mp4',
  sizeBytes: 1,
  blobKey: 'blob:asset_dur',
  proxyBlobKey: null,
  thumbnailBlobKey: null,
  waveform: null,
  durationMs: 10_000,
  width: 1920,
  height: 1080,
  frameRate: 30,
  hasAudio: true,
  videoCodec: null,
  playable: true,
  license: null,
  importedAt: '2026-01-01T00:00:00.000Z',
};

describe('state/projectStore · meta.durationMs 派生量刷新', () => {
  beforeEach(() => {
    reset();
    useProjectStore.getState().setDoc(
      { ...useProjectStore.getState().doc, assets: { [ASSET.id]: ASSET } },
      { markDirty: false },
    );
  });

  it('空工程的 durationMs 为 0', () => {
    expect(useProjectStore.getState().doc.meta.durationMs).toBe(0);
  });

  it('新增 clip 后 durationMs 立即刷新（无需保存/重载）', () => {
    const track = useProjectStore.getState().doc.tracks.find((item) => item.type === 'video');
    expect(track).toBeDefined();

    addClip({
      assetId: ASSET.id,
      trackId: track!.id,
      startMs: 0,
      inMs: 0,
      outMs: 3000,
    });

    const { doc } = useProjectStore.getState();
    expect(doc.meta.durationMs).toBe(3000);
    expect(doc.meta.durationMs).toBe(computeProjectDuration(doc));
  });

  it('删除 clip 后 durationMs 回落到剩余轨道长度', () => {
    const track = useProjectStore.getState().doc.tracks.find((item) => item.type === 'video')!;
    addClip({ assetId: ASSET.id, trackId: track.id, startMs: 0, inMs: 0, outMs: 3000 });
    addClip({ assetId: ASSET.id, trackId: track.id, startMs: 5000, inMs: 0, outMs: 2000 });
    expect(useProjectStore.getState().doc.meta.durationMs).toBe(7000);

    const clipId = useProjectStore.getState().doc.tracks
      .find((item) => item.type === 'video')!
      .clips.find((clip) => clip.startMs === 5000)!.id;
    deleteClip(clipId);

    expect(useProjectStore.getState().doc.meta.durationMs).toBe(3000);
  });

  it('undo 后 durationMs 同步回落（patches 不含 meta，必须重算）', () => {
    const track = useProjectStore.getState().doc.tracks.find((item) => item.type === 'video')!;
    addClip({ assetId: ASSET.id, trackId: track.id, startMs: 0, inMs: 0, outMs: 4000 });
    expect(useProjectStore.getState().doc.meta.durationMs).toBe(4000);

    expect(useProjectStore.getState().undo()).toBe(true);

    const { doc } = useProjectStore.getState();
    expect(doc.meta.durationMs).toBe(0);
    expect(doc.meta.durationMs).toBe(computeProjectDuration(doc));
  });

  it('redo 后 durationMs 同步恢复', () => {
    const track = useProjectStore.getState().doc.tracks.find((item) => item.type === 'video')!;
    addClip({ assetId: ASSET.id, trackId: track.id, startMs: 0, inMs: 0, outMs: 4000 });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().doc.meta.durationMs).toBe(0);

    expect(useProjectStore.getState().redo()).toBe(true);
    expect(useProjectStore.getState().doc.meta.durationMs).toBe(4000);
  });

  it('setDoc 也会刷新（外部注入陈旧 meta 时自愈）', () => {
    const doc = useProjectStore.getState().doc;
    const track = doc.tracks.find((item) => item.type === 'video')!;
    addClip({ assetId: ASSET.id, trackId: track.id, startMs: 0, inMs: 0, outMs: 2500 });

    // 手工塞一个陈旧的 meta（模拟历史文档 / 外部数据）
    const stale = {
      ...useProjectStore.getState().doc,
      meta: { ...doc.meta, durationMs: 999_999 },
    };
    useProjectStore.getState().setDoc(stale, { markDirty: false });

    expect(useProjectStore.getState().doc.meta.durationMs).toBe(2500);
  });

  it('关键：exportPlan 读到的 durationMs 不再是 0（导出不会得到 0 长度视频）', () => {
    const track = useProjectStore.getState().doc.tracks.find((item) => item.type === 'video')!;
    addClip({ assetId: ASSET.id, trackId: track.id, startMs: 0, inMs: 0, outMs: 5000 });

    const plan = buildExportPlan(useProjectStore.getState().doc, {
      width: 1920,
      height: 1080,
      fps: 30,
      format: 'mp4',
      videoBitrate: 8_000_000,
      audioBitrate: 192_000,
      burnInSubtitle: false,
    });
    expect(plan.durationMs).toBe(5000);
    expect(plan.totalFrames).toBeGreaterThan(0);
  });

  it('裁剪 clip 改变 durationMs 后也保持一致', () => {
    const track = useProjectStore.getState().doc.tracks.find((item) => item.type === 'video')!;
    addClip({ assetId: ASSET.id, trackId: track.id, startMs: 0, inMs: 0, outMs: 5000 });
    const clipId = useProjectStore.getState().doc.tracks
      .find((item) => item.type === 'video')!
      .clips[0]!.id;

    setClipProperty(clipId, 'startMs', 1000);

    const { doc } = useProjectStore.getState();
    expect(doc.meta.durationMs).toBe(computeProjectDuration(doc));
  });
});