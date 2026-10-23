/**
 * 其余领域操作测试：素材 / 字幕 / 设置 / 轨道。
 */

import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDoc } from '@clipcut/shared-types';
import { deserialize } from '../../project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import {
  addAsset,
  addSubtitleCue,
  addTextClip,
  addTrack,
  InvalidOperationError,
  removeAsset,
  removeSubtitleCue,
  removeTrack,
  resizeCanvas,
  setAiSettings,
  setCanvasSettings,
  setClipLabel,
  setExportSettings,
  setSubtitleCues,
  setSubtitleSettings,
  setTrackFlags,
  updateAsset,
  updateSubtitleCue,
  type OperationContext,
} from '../index.js';

/** 构造测试上下文。 */
function makeContext(doc: ProjectDoc): OperationContext {
  return { doc, assets: doc.assets };
}

/** 构造一个测试素材。 */
function makeAsset(id = 'asset_new'): Asset {
  return {
    id,
    type: 'image',
    name: 'new.png',
    sourceType: 'local',
    mimeType: 'image/png',
    sizeBytes: 100,
    blobKey: `blob:${id}`,
    proxyBlobKey: null,
    thumbnailBlobKey: null,
    waveform: null,
    durationMs: 0,
    width: 100,
    height: 100,
    frameRate: null,
    hasAudio: false,
    videoCodec: null,
    playable: true,
    license: null,
    importedAt: '2026-10-23T00:00:00.000Z',
  };
}

describe('domain/timeline/operations · 素材 / 字幕 / 设置', () => {
  it('新增素材', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const result = addAsset(makeContext(doc), makeAsset());
    expect(result.doc.assets['asset_new']).toBeDefined();
    expect(result.doc.assets['asset_new']?.name).toBe('new.png');
  });

  it('重复新增素材抛错', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const withAsset = addAsset(makeContext(doc), makeAsset()).doc;
    expect(() => addAsset(makeContext(withAsset), makeAsset())).toThrowError(InvalidOperationError);
  });

  it('更新素材属性', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const result = updateAsset(makeContext(doc), 'asset_min01', { name: 'renamed.mp4' });
    expect(result.doc.assets['asset_min01']?.name).toBe('renamed.mp4');
  });

  it('更新不存在的素材抛错', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    expect(() => updateAsset(makeContext(doc), 'nope', { name: 'x' })).toThrowError(
      InvalidOperationError,
    );
  });

  it('删除素材会移除引用它的 clip', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = removeAsset(makeContext(doc), 'asset_full03');
    expect(result.doc.assets['asset_full03']).toBeUndefined();
    expect(result.doc.tracks.flatMap((t) => t.clips).some((c) => c.id === 'clip_full_c2')).toBe(false);
  });

  it('删除不存在的素材抛错', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    expect(() => removeAsset(makeContext(doc), 'nope')).toThrowError(InvalidOperationError);
  });

  it('新增文字片段', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = addTextClip(makeContext(doc), {
      trackId: 'track_full_t1',
      startMs: 20_000,
      durationMs: 2000,
      content: '你好',
    });
    const clip = result.doc.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === result.selectedClipId);
    expect(clip?.assetId).toBeNull();
    expect(clip?.text?.content).toBe('你好');
    expect(clip?.isOverlay).toBe(true);
  });

  it('设置 clip 备注', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const result = setClipLabel(makeContext(doc), 'clip_min_c1', '片头');
    expect(
      result.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_min_c1')?.label,
    ).toBe('片头');
  });

  it('新增轨道（追加到末尾）', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const result = addTrack(makeContext(doc), { type: 'audio', name: '新音频轨' });
    const added = result.doc.tracks[result.doc.tracks.length - 1];
    expect(added?.type).toBe('audio');
    expect(added?.name).toBe('新音频轨');
    expect(added?.height).toBe(56);
  });

  it('新增轨道（插入到指定位置）', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const result = addTrack(makeContext(doc), { type: 'text', name: '插到最前', index: 0 });
    expect(result.doc.tracks[0]?.name).toBe('插到最前');
  });

  it('删除不存在的轨道抛错', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    expect(() => removeTrack(makeContext(doc), 'nope')).toThrow();
  });

  it('设置轨道标志', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const result = setTrackFlags(makeContext(doc), 'track_min_v1', {
      muted: true,
      hidden: true,
      locked: true,
      order: 7,
    });
    const track = result.doc.tracks.find((t) => t.id === 'track_min_v1');
    expect(track?.muted).toBe(true);
    expect(track?.hidden).toBe(true);
    expect(track?.locked).toBe(true);
    expect(track?.order).toBe(7);
  });

  it('字幕：新增 / 更新 / 删除 / 批量替换', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));

    const added = addSubtitleCue(makeContext(doc), { startMs: 10_000, endMs: 12_000, text: '新字幕' });
    const cueId = added.doc.subtitles.cues[added.doc.subtitles.cues.length - 1]?.id;
    expect(cueId).toBeDefined();

    const updated = updateSubtitleCue(makeContext(added.doc), cueId as string, { text: '改过的字幕' });
    expect(updated.doc.subtitles.cues.find((c) => c.id === cueId)?.text).toBe('改过的字幕');

    const removed = removeSubtitleCue(makeContext(updated.doc), cueId as string);
    expect(removed.doc.subtitles.cues.some((c) => c.id === cueId)).toBe(false);

    const replaced = setSubtitleCues(makeContext(removed.doc), [
      { startMs: 0, endMs: 1000, text: 'A' },
      { startMs: 1000, endMs: 2000, text: 'B' },
    ]);
    expect(replaced.doc.subtitles.cues).toHaveLength(2);
  });

  it('字幕：开关与样式', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = setSubtitleSettings(makeContext(doc), {
      enabled: true,
      style: { fontSize: 60, color: '#FF0000' },
    });
    expect(result.doc.subtitles.enabled).toBe(true);
    expect(result.doc.subtitles.style.fontSize).toBe(60);
    expect(result.doc.subtitles.style.color).toBe('#FF0000');
  });

  it('画布与导出设置', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const canvas = setCanvasSettings(makeContext(doc), { fps: 60, backgroundColor: '#111111' });
    expect(canvas.doc.settings.canvas.fps).toBe(60);
    expect(canvas.doc.settings.canvas.backgroundColor).toBe('#111111');

    const exportSettings = setExportSettings(makeContext(canvas.doc), {
      format: 'webm',
      videoBitrate: 4_000_000,
    });
    expect(exportSettings.doc.settings.export.format).toBe('webm');
    expect(exportSettings.doc.settings.export.videoBitrate).toBe(4_000_000);
  });

  it('AI 路由与 Provider 设置', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const result = setAiSettings(makeContext(doc), {
      routes: { asr: 'local-http' },
      providers: {
        'local-http': { type: 'local', baseUrl: 'http://localhost:11434', model: 'whisper', apiKey: null },
      },
    });
    expect(result.doc.settings.ai.routes.asr).toBe('local-http');
    expect(result.doc.settings.ai.providers['local-http']?.baseUrl).toBe('http://localhost:11434');
  });

  it('修改画布尺寸会换算 transform 与字号', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const result = resizeCanvas(makeContext(doc), 1080, 1920);
    expect(result.doc.settings.canvas.width).toBe(1080);
    expect(result.doc.settings.canvas.height).toBe(1920);

    const pip = result.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c2');
    expect(pip?.transform.x).toBeCloseTo(0.75 * (1080 / 1920), 6);

    const text = result.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c4');
    expect(text?.text?.fontSize).toBeCloseTo(64 * (1920 / 1080), 6);
  });
});
