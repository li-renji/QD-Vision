/**
 * 画布比例变更的 transform / fontSize 换算测试（FR-026①）。
 */

import { describe, expect, it } from 'vitest';
import { deserialize } from '../../project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import { applyCanvasResize } from '../index.js';

describe('domain/timeline/transform', () => {
  it('16:9 → 9:16 时 x/y 按宽高比换算，字号按高度换算', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const clipBefore = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c2');
    expect(clipBefore).toBeDefined();

    const { doc: next, scaleX, scaleY, fontScale } = applyCanvasResize(doc, 1080, 1920);
    expect(scaleX).toBeCloseTo(1080 / 1920, 6);
    expect(scaleY).toBeCloseTo(1920 / 1080, 6);
    expect(fontScale).toBeCloseTo(1920 / 1080, 6);

    const clipAfter = next.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c2');
    expect(clipAfter?.transform.x).toBeCloseTo((clipBefore?.transform.x ?? 0) * scaleX, 6);
    expect(clipAfter?.transform.y).toBeCloseTo((clipBefore?.transform.y ?? 0) * scaleY, 6);
  });

  it('文字 clip 的 fontSize 按新画布高度换算', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const textBefore = doc.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === 'clip_full_c4');
    expect(textBefore?.text?.fontSize).toBe(64);

    const { doc: next } = applyCanvasResize(doc, 1920, 2160);
    const textAfter = next.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c4');
    expect(textAfter?.text?.fontSize).toBeCloseTo(128, 6);
  });

  it('画布尺寸被写入新值', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const { doc: next } = applyCanvasResize(doc, 1080, 1080);
    expect(next.settings.canvas.width).toBe(1080);
    expect(next.settings.canvas.height).toBe(1080);
  });

  it('原文档不被修改（不可变更新）', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    const before = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c2');
    applyCanvasResize(doc, 1080, 1920);
    const after = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === 'clip_full_c2');
    expect(after?.transform.x).toBe(before?.transform.x);
  });
});
