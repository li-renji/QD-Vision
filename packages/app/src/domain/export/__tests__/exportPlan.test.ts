/**
 * 导出计划：非法组合检测与降级建议（FR-038①）。
 */

import { describe, expect, it } from 'vitest';
import { deserialize } from '../../project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import { buildExportPlan, resolveResolution, RESOLUTION_PRESETS } from '../exportPlan.js';

describe('domain/export/exportPlan', () => {
  it('计算总帧数与预计体积', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const plan = buildExportPlan(doc, {
      width: 1920,
      height: 1080,
      fps: 30,
      format: 'mp4',
      videoBitrate: 8_000_000,
      audioBitrate: 192_000,
      burnInSubtitle: false,
    });

    expect(plan.totalFrames).toBe(900);
    expect(plan.durationMs).toBe(30_000);
    expect(plan.frameDurationMs).toBeCloseTo(33.333, 2);
    expect(plan.estimatedSizeBytes).toBeGreaterThan(0);
    expect(plan.errors).toEqual([]);
  });

  it('4K@60 给出明确提示与降级建议', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const plan = buildExportPlan(doc, {
      width: 3840,
      height: 2160,
      fps: 60,
      format: 'mp4',
      videoBitrate: 40_000_000,
      audioBitrate: 192_000,
      burnInSubtitle: false,
    });

    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.suggestions).toContain('降至 30fps');
    expect(plan.suggestions).toContain('降至 1080p');
  });

  it('分辨率预设解析', () => {
    expect(resolveResolution('canvas', 1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(resolveResolution('1080p', 1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(resolveResolution('4k', 1920, 1080)).toEqual({
      width: RESOLUTION_PRESETS['4k'].width,
      height: RESOLUTION_PRESETS['4k'].height,
    });
  });

  it('零时长工程至少产生 1 帧', () => {
    const { doc } = deserialize(readFixtureJson('minimal.clipcut.json'));
    const empty = { ...doc, meta: { ...doc.meta, durationMs: 0 } };
    const plan = buildExportPlan(empty, {
      width: 1920,
      height: 1080,
      fps: 30,
      format: 'mp4',
      videoBitrate: 8_000_000,
      audioBitrate: 192_000,
      burnInSubtitle: false,
    });
    expect(plan.totalFrames).toBe(1);
  });
});
