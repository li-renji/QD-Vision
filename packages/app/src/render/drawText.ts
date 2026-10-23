/**
 * Canvas 文本绘制：多行换行、描边、背景、行高、字间距、对齐、垂直对齐。
 */

import {
  REFERENCE_CANVAS_HEIGHT,
  type ClipTextProps,
  type ClipTransform,
} from '@clipcut/shared-types';
import { applyTransform } from './drawTransform.js';

/** 文本块度量结果。 */
export interface TextBlockMetrics {
  lines: string[];
  /** 单行行高（像素） */
  lineHeightPx: number;
  /** 文本块宽度 */
  width: number;
  /** 文本块高度 */
  height: number;
}

/** 是否包含中日韩字符（需要逐字折行）。 */
function hasCjk(text: string): boolean {
  return /[\u3000-\u9fff\uff00-\uffef]/.test(text);
}

/** 构造字体串。 */
export function buildFontString(text: ClipTextProps, fontScale: number): string {
  const size = Math.max(1, text.fontSize * fontScale);
  return `${text.fontStyle} ${text.fontWeight} ${size}px "${text.fontFamily}", sans-serif`;
}

/**
 * 计算文本块度量（按 `maxWidth` 折行）。
 */
export function measureTextBlock(
  ctx: CanvasRenderingContext2D,
  text: ClipTextProps,
  fontScale: number,
  maxWidth: number,
): TextBlockMetrics {
  ctx.save();
  ctx.font = buildFontString(text, fontScale);
  ctx.letterSpacing = `${text.letterSpacing}px`;

  const paragraphs = text.content.split('\n');
  const lines: string[] = [];
  const cjk = hasCjk(text.content);

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    const units = cjk ? Array.from(paragraph) : paragraph.split(/(\s+)/);
    let current = '';
    for (const unit of units) {
      const candidate = current + unit;
      if (current.length > 0 && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current.trimEnd());
        current = unit.trimStart();
      } else {
        current = candidate;
      }
    }
    if (current.length > 0 || lines.length === 0) lines.push(current.trimEnd());
  }

  const fontSize = Math.max(1, text.fontSize * fontScale);
  const lineHeightPx = fontSize * text.lineHeight;
  let width = 0;
  for (const line of lines) {
    width = Math.max(width, ctx.measureText(line).width);
  }

  ctx.restore();

  return {
    lines,
    lineHeightPx,
    width,
    height: Math.max(lineHeightPx, lines.length * lineHeightPx),
  };
}

/** 文本绘制参数。 */
export interface DrawTextOptions {
  text: ClipTextProps;
  transform: ClipTransform;
  canvasWidth: number;
  canvasHeight: number;
  /** 允许的最大宽度（默认画布宽度的 90%） */
  maxWidth?: number;
  /** 字号缩放系数（画布高 / 1080） */
  fontScale?: number;
}

/**
 * 绘制一个文字图层。
 */
export function drawTextLayer(ctx: CanvasRenderingContext2D, options: DrawTextOptions): void {
  const { text, transform, canvasWidth, canvasHeight } = options;
  const fontScale = options.fontScale ?? canvasHeight / REFERENCE_CANVAS_HEIGHT;
  const maxWidth = options.maxWidth ?? canvasWidth * 0.9;

  const metrics = measureTextBlock(ctx, text, fontScale, maxWidth);

  applyTransform(ctx, transform, {
    canvasWidth,
    canvasHeight,
    contentWidth: metrics.width,
    contentHeight: metrics.height,
  });

  ctx.font = buildFontString(text, fontScale);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // 竖直对齐：在文本块内按 verticalAlign 排布
  let startY = 0;
  if (text.verticalAlign === 'middle') {
    startY = (metrics.height - metrics.lines.length * metrics.lineHeightPx) / 2;
  } else if (text.verticalAlign === 'bottom') {
    startY = metrics.height - metrics.lines.length * metrics.lineHeightPx;
  }

  // 背景色
  if (text.backgroundColor) {
    ctx.save();
    ctx.fillStyle = text.backgroundColor;
    const padding = fontScale * 8;
    ctx.fillRect(
      -padding,
      startY - metrics.lineHeightPx * 0.85 - padding,
      metrics.width + padding * 2,
      metrics.lines.length * metrics.lineHeightPx + padding * 2,
    );
    ctx.restore();
  }

  // 字间距（浏览器不支持时退化为逐字符绘制）
  const supportsLetterSpacing =
    (ctx as unknown as { letterSpacing?: unknown }).letterSpacing !== undefined;

  metrics.lines.forEach((line, index) => {
    const baseline = startY + index * metrics.lineHeightPx + metrics.lineHeightPx * 0.8;
    const lineWidth = ctx.measureText(line).width;

    let x = 0;
    if (text.align === 'center') x = (metrics.width - lineWidth) / 2;
    else if (text.align === 'right') x = metrics.width - lineWidth;

    if (supportsLetterSpacing) {
      ctx.letterSpacing = `${text.letterSpacing}px`;
    }

    if (text.strokeWidth > 0) {
      ctx.save();
      ctx.strokeStyle = text.strokeColor;
      ctx.lineWidth = text.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      if (supportsLetterSpacing) {
        ctx.strokeText(line, x, baseline);
      } else {
        drawTextPerCharacter(ctx, line, x, baseline, (char, cx) => ctx.strokeText(char, cx, baseline));
      }
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = text.color;
    if (supportsLetterSpacing) {
      ctx.fillText(line, x, baseline);
    } else {
      drawTextPerCharacter(ctx, line, x, baseline, (char, cx) => ctx.fillText(char, cx, baseline));
    }
    ctx.restore();
  });

  ctx.restore();
}

/** 逐字符绘制（letterSpacing 不支持时的降级路径）。 */
function drawTextPerCharacter(
  ctx: CanvasRenderingContext2D,
  line: string,
  startX: number,
  baseline: number,
  draw: (char: string, x: number) => void,
): void {
  let x = startX;
  for (const char of Array.from(line)) {
    draw(char, x);
    x += ctx.measureText(char).width;
  }
}
