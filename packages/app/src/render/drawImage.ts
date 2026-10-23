/**
 * 单图层绘制：`fit` 模式（contain / cover / fill）+ `transform` 应用。
 */

import type { ClipTransform, FitMode } from '@clipcut/shared-types';
import { applyCornerRadius, applyTransform } from './drawTransform.js';

/** 目标矩形。 */
export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 依据 `fit` 模式计算内容在画布中的目标尺寸。
 *
 * - `contain`：完整放入画布（等比缩小）
 * - `cover`：填满画布（等比放大并裁切）
 * - `fill`：拉伸填满画布
 */
export function computeFitRect(
  fit: FitMode,
  contentWidth: number,
  contentHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): FitRect {
  if (contentWidth <= 0 || contentHeight <= 0) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  }

  switch (fit) {
    case 'cover': {
      const scale = Math.max(canvasWidth / contentWidth, canvasHeight / contentHeight);
      return {
        x: 0,
        y: 0,
        width: contentWidth * scale,
        height: contentHeight * scale,
      };
    }
    case 'fill':
      return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    case 'contain':
    default: {
      const scale = Math.min(canvasWidth / contentWidth, canvasHeight / contentHeight);
      return {
        x: 0,
        y: 0,
        width: contentWidth * scale,
        height: contentHeight * scale,
      };
    }
  }
}

/** 绘制图片图层的参数。 */
export interface DrawImageOptions {
  fit: FitMode;
  transform: ClipTransform;
  canvasWidth: number;
  canvasHeight: number;
  /** 图片自然尺寸 */
  contentWidth: number;
  contentHeight: number;
  /** 圆角（仅 isOverlay 生效，由调用方决定是否传 0） */
  cornerRadius: number;
}

/**
 * 绘制一个图片图层。
 *
 * 调用方负责 `ctx.save()` / `ctx.restore()` 配对。
 */
export function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  options: DrawImageOptions,
): void {
  const rect = computeFitRect(
    options.fit,
    options.contentWidth,
    options.contentHeight,
    options.canvasWidth,
    options.canvasHeight,
  );

  applyTransform(ctx, options.transform, {
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    contentWidth: rect.width,
    contentHeight: rect.height,
  });

  if (options.cornerRadius > 0) {
    applyCornerRadius(ctx, options.cornerRadius, rect.width, rect.height);
  }

  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}
