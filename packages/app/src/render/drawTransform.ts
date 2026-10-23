/**
 * `transform` → Canvas 变换矩阵计算。
 *
 * **PIP 与文字共用同一实现**（FR-030）。
 */

import type { ClipTransform } from '@clipcut/shared-types';

/** 变换应用参数。 */
export interface TransformApplyOptions {
  /** 画布宽（像素） */
  canvasWidth: number;
  /** 画布高（像素） */
  canvasHeight: number;
  /** 内容自身尺寸（像素） */
  contentWidth: number;
  contentHeight: number;
}

/**
 * 应用变换：调用后当前坐标系原点位于内容中心。
 *
 * 变换顺序：平移到 (x·W, y·H) → 旋转 → 缩放 → 平移到内容中心。
 * 必须在配对的 `restore()` 之前调用 `save()`。
 */
export function applyTransform(
  ctx: CanvasRenderingContext2D,
  transform: ClipTransform,
  options: TransformApplyOptions,
): void {
  const { canvasWidth, canvasHeight, contentWidth, contentHeight } = options;

  ctx.save();
  ctx.globalAlpha *= Math.min(1, Math.max(0, transform.opacity));
  ctx.translate(transform.x * canvasWidth, transform.y * canvasHeight);
  if (transform.rotation !== 0) {
    ctx.rotate((transform.rotation * Math.PI) / 180);
  }
  if (transform.scale !== 1) {
    ctx.scale(transform.scale, transform.scale);
  }
  ctx.translate(-contentWidth / 2, -contentHeight / 2);
}

/** 圆角裁剪路径（需在 `applyTransform` 之后、绘制之前调用）。 */
export function applyCornerRadius(
  ctx: CanvasRenderingContext2D,
  radius: number,
  width: number,
  height: number,
): void {
  const r = Math.min(Math.max(0, radius), Math.min(width, height) / 2);
  if (r <= 0) return;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height);
  ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();
}
