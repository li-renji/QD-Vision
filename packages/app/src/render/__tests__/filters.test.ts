/**
 * 滤镜映射测试：preset + intensity → `ctx.filter` CSS 字符串。
 */

import { describe, expect, it } from 'vitest';
import type { ClipFilter } from '@clipcut/shared-types';
import { FILTER_PRESET_IDS, clipFilterCss } from '../filters.js';

/** 构造一个滤镜对象。 */
function makeFilter(preset: ClipFilter['preset'], intensity: number): ClipFilter {
  return { preset, intensity };
}

describe('clipFilterCss', () => {
  it('undefined / none / 强度 0 → none', () => {
    expect(clipFilterCss(undefined)).toBe('none');
    expect(clipFilterCss(makeFilter('none', 1))).toBe('none');
    expect(clipFilterCss(makeFilter('vivid', 0))).toBe('none');
  });

  it('每个预设都能产出合法的 CSS filter 字符串', () => {
    for (const preset of FILTER_PRESET_IDS) {
      const css = clipFilterCss(makeFilter(preset, 1));
      expect(css).not.toBe('none');
      // 基本形态：`函数(参数)`，可被 CSS 过滤器语法接受。
      expect(css).toMatch(/^[a-z-]+\([^)]*\)( [a-z-]+\([^)]*\))*$/);
    }
  });

  it('强度单调：vivid 的 saturate 随强度递增', () => {
    const low = clipFilterCss(makeFilter('vivid', 0.25));
    const high = clipFilterCss(makeFilter('vivid', 1));
    const saturateOf = (css: string): number =>
      Number(/saturate\(([\d.]+)\)/.exec(css)?.[1] ?? '0');
    expect(saturateOf(high)).toBeGreaterThan(saturateOf(low));
  });

  it('mono 满强度即完全去色', () => {
    expect(clipFilterCss(makeFilter('mono', 1))).toBe('grayscale(1.000)');
  });

  it('越界强度被钳制到 0~1', () => {
    // 1.5 → 视为满强度（不产出 >1 的参数）
    expect(clipFilterCss(makeFilter('mono', 1.5))).toBe('grayscale(1.000)');
    // -1 → 视为 0 → none
    expect(clipFilterCss(makeFilter('mono', -1))).toBe('none');
  });

  it('未知预设 → none（前向兼容，不崩溃）', () => {
    expect(clipFilterCss(makeFilter('no-such-preset' as ClipFilter['preset'], 1))).toBe('none');
  });
});
