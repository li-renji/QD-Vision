/**
 * `buildFontString` 的回归测试。
 *
 * 核心防线：`fontFamily` 来自用户的**自由文本输入**，而 `ctx.font` 用的是
 * CSS `font` 简写 —— 简写里无法转义双引号，字体名一旦含 `"`，整条赋值会被
 * 浏览器**静默拒绝**，导致连字号都不生效（文字按旧字号渲染）。
 *
 * 该行为已在 Chromium 实测确认：`fontFamily = 'Arial"'` → `ctx.font` 保持上一次的值。
 */

import { describe, expect, it } from 'vitest';
import { buildFontString } from '../drawText.js';
import type { ClipTextProps } from '@clipcut/shared-types';

/** 构造最小可用的文字属性。 */
function makeText(overrides: Partial<ClipTextProps> = {}): ClipTextProps {
  return {
    content: '测试文字',
    fontFamily: 'Noto Sans SC',
    fontSize: 100,
    fontWeight: 700,
    fontStyle: 'normal',
    color: '#FFFFFF',
    strokeColor: '#000000',
    strokeWidth: 0,
    backgroundColor: null,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: 'center',
    verticalAlign: 'middle',
    ...overrides,
  } as ClipTextProps;
}

describe('buildFontString', () => {
  it('常规字体名原样保留，并始终带 sans-serif 兜底', () => {
    expect(buildFontString(makeText({ fontFamily: 'Noto Sans SC' }), 1)).toBe(
      'normal 700 100px "Noto Sans SC", sans-serif',
    );
    expect(buildFontString(makeText({ fontFamily: 'Arial' }), 1)).toBe(
      'normal 700 100px "Arial", sans-serif',
    );
  });

  it('去掉双引号 / 反斜杠 / 控制字符 —— 否则整条 font 赋值会被浏览器静默拒绝', () => {
    const dirty = buildFontString(makeText({ fontFamily: 'Arial"' }), 1);
    expect(dirty).toBe('normal 700 100px "Arial", sans-serif');

    // 只校验**字体名本体**（剥掉外层成对引号）不含引号/反斜杠 ——
    // 外层那对引号是合法的字体名定界符，必须保留。
    const mixed = buildFontString(makeText({ fontFamily: 'Mi"x\\ed' }), 1);
    const inner = /px "(.*)", sans-serif$/.exec(mixed)?.[1] ?? '';
    expect(inner).toBe('Mixed');
    expect(inner).not.toMatch(/["\\]/);
  });

  it('保留逗号 —— 引号内的逗号属于字体名本身，不是分隔符', () => {
    expect(buildFontString(makeText({ fontFamily: 'Arial, sans-serif' }), 1)).toBe(
      'normal 700 100px "Arial, sans-serif", sans-serif',
    );
  });

  it('字体名为空 / 全是脏字符时退化为纯 sans-serif，不生成空引号', () => {
    expect(buildFontString(makeText({ fontFamily: '' }), 1)).toBe('normal 700 100px sans-serif');
    expect(buildFontString(makeText({ fontFamily: '""' }), 1)).toBe('normal 700 100px sans-serif');
  });

  it('按 fontScale 缩放字号，且字号永不为 0', () => {
    expect(buildFontString(makeText({ fontSize: 100 }), 0.5)).toContain('50px');
    expect(buildFontString(makeText({ fontSize: 100 }), 0)).toContain('1px');
    expect(buildFontString(makeText({ fontSize: -50 }), 1)).toContain('1px');
  });
});