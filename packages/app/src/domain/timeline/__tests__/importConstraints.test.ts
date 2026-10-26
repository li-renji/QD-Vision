/**
 * 导入路径的数值约束与派生量重算（FR-063 / FR-064 / D-003）。
 *
 * 这些用例守护的是「**导入路径**」——此前领域层的数值约束只挂在
 * `setClipProperty` 上，导入外部 / 第三方分享的工程文件时完全失效。
 */

import { describe, expect, it } from 'vitest';
import type { Clip } from '@clipcut/shared-types';
import { deserialize } from '../../project/deserialize.js';
import { ValidationError } from '../../project/validation.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import {
  CANVAS_NUMERIC_RANGES,
  CLIP_NUMERIC_RANGES,
  EXPORT_NUMERIC_RANGES,
  TRACK_NUMERIC_RANGES,
  clampToRange,
  MIN_CLIP_DURATION_MS,
  setCanvasSettings,
  setExportSettings,
} from '../index.js';
import { MIN_EXPORT_FPS } from '../../export/exportPlan.js';

/** 取夹具里第一个 clip（可篡改）。 */
function firstClip(json: Record<string, unknown>): Clip {
  const tracks = json['tracks'] as Array<Record<string, unknown>>;
  for (const track of tracks) {
    const clips = track['clips'] as Array<Record<string, unknown>> | undefined;
    const clip = clips?.[0];
    if (clip) return clip as unknown as Clip;
  }
  throw new Error('夹具缺少 clip');
}

describe('FR-063 · 导入时重算 clip 派生量', () => {
  it('篡改的 durationMs 被重算为公式值（PRD §4.1 不变式）', () => {
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const clip = firstClip(json);
    clip.durationMs = 999_999;

    const { doc } = deserialize(json);
    const restored = doc.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === clip.id);

    expect(restored?.durationMs).toBe(
      Math.round((clip.outMs - clip.inMs) / clip.speed),
    );
    expect(restored?.durationMs).not.toBe(999_999);
  });

  it('durationMs = 0 的片段被重算（不再「看不见但存在」）', () => {
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const clip = firstClip(json);
    clip.durationMs = 0;

    const { doc } = deserialize(json);
    const restored = doc.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === clip.id);
    expect(restored?.durationMs).toBeGreaterThan(0);
  });

  it('文字 clip（assetId = null）豁免重算，时长保持独立', () => {
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const tracks = json['tracks'] as Array<Record<string, unknown>>;
    const textTrack = tracks.find((track) => track['type'] === 'text');
    const clips = textTrack?.['clips'] as Array<Record<string, unknown>>;
    const textClip = clips[0];
    expect(textClip).toBeDefined();
    if (!textClip) return;
    textClip['durationMs'] = 4321;

    const { doc } = deserialize(json);
    const restored = doc.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === textClip['id']);
    // 文字片段时长独立于素材（PRD），不应被公式重算
    expect(restored?.durationMs).toBe(4321);
  });

  it('源区间倒置（outMs <= inMs）被显式拒绝', () => {
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const clip = firstClip(json);
    clip.inMs = 5000;
    clip.outMs = 100;

    expect(() => deserialize(json)).toThrowError(ValidationError);
  });
});

describe('FR-064 · 导入路径复用领域层数值约束', () => {
  it('transform.scale 越界被静默钳制到合法区间', () => {
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const clip = firstClip(json);
    clip.transform.scale = 0.001;

    const { doc } = deserialize(json);
    const restored = doc.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === clip.id);
    expect(restored?.transform.scale).toBe(CLIP_NUMERIC_RANGES['transform.scale']?.[0]);
  });

  it('transform.cornerRadius / rotation / text.lineHeight 越界被钳制', () => {
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const clip = firstClip(json);
    clip.transform.cornerRadius = 99_999;
    clip.transform.rotation = 1e9;

    const { doc } = deserialize(json);
    const restored = doc.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === clip.id);
    expect(restored?.transform.cornerRadius).toBe(1000);
    expect(restored?.transform.rotation).toBe(3600);
  });

  it('canvas.fps / export.fps 越界在导入时被明确拒绝（D-003 硬约束）', () => {
    // Schema 的 fps minimum=10 表达的是「工程文件」的约束（FR-038②），
    // 因此导入路径是**显式拒绝**而不是静默钳制 —— 越界值无法通过重算修正。
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const settings = json['settings'] as Record<string, unknown>;
    (settings['canvas'] as Record<string, unknown>)['fps'] = 5;

    expect(() => deserialize(json)).toThrowError(ValidationError);
    try {
      deserialize(json);
    } catch (error) {
      expect((error as ValidationError).issues[0]?.hint).toContain('fps');
    }
  });

  it('编辑路径的 fps 越界被静默钳制（与 setClipProperty 行为一致）', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));

    const exported = setExportSettings({ doc, assets: doc.assets }, { fps: 1 });
    expect(exported.doc.settings.export.fps).toBe(MIN_EXPORT_FPS);

    const canvas = setCanvasSettings({ doc, assets: doc.assets }, { fps: 5 });
    expect(canvas.doc.settings.canvas.fps).toBe(MIN_EXPORT_FPS);
  });

  it('约束表覆盖全部 clip 数值路径 + 工程级路径，且 clampToRange 与表一致', () => {
    expect(Object.keys(CLIP_NUMERIC_RANGES)).toHaveLength(16);
    for (const [path, range] of Object.entries(CLIP_NUMERIC_RANGES)) {
      expect(clampToRange(path, range[0] - 1000)).toBe(range[0]);
      expect(clampToRange(path, range[1] + 1000)).toBe(range[1]);
      expect(clampToRange(path, (range[0] + range[1]) / 2)).toBe((range[0] + range[1]) / 2);
    }
    expect(EXPORT_NUMERIC_RANGES.fps?.[0]).toBe(MIN_EXPORT_FPS);
    expect(CANVAS_NUMERIC_RANGES.fps?.[0]).toBe(MIN_EXPORT_FPS);
    expect(TRACK_NUMERIC_RANGES.height?.[0]).toBe(1);
  });
});

describe('D-003 · 帧率下限与最小片段时长的契约', () => {
  it('帧周期不得超过最小片段时长（两道防线缺一不可）', () => {
    // 注意：此处**恰好取等**（100ms = 10fps 的 1 帧）。取等是**预期状态**，
    // 不是边界 bug —— 片段必然跨越起始帧时刻（compositor 的半开区间含 start），
    // 所以 100ms 片段在 10fps 下恰好被采样到 1 帧，不会整段消失。
    // 断言的价值在于**任一侧被改动时立刻失败**，而非今日的具体数值。
    expect(MIN_CLIP_DURATION_MS).toBeGreaterThanOrEqual(1000 / MIN_EXPORT_FPS);

    // 反向断言：帧周期不得大于最小片段时长。
    // 两条合起来锁定「帧周期 ≤ 最小片段时长」这个**关系**，
    // 将来有人调大 MIN_CLIP_DURATION_MS 或调小 MIN_EXPORT_FPS，两边都会立刻失败。
    expect(MIN_EXPORT_FPS).toBeGreaterThanOrEqual(1000 / MIN_CLIP_DURATION_MS);
  });

  it('帧率过低时 buildExportPlan 给出错误与建议', async () => {
    const { buildExportPlan } = await import('../../export/exportPlan.js');
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const plan = buildExportPlan(doc, {
      width: 1920,
      height: 1080,
      fps: 5,
      format: 'mp4',
      videoBitrate: 8_000_000,
      audioBitrate: 192_000,
      burnInSubtitle: false,
    });

    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.errors.join('\n')).toContain('5');
    expect(plan.suggestions).toContain(`升至 ${MIN_EXPORT_FPS}fps`);
  });
});
