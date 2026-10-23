/**
 * 渲染层出口。
 *
 * 本层**不知道 React 存在**：预览与导出复用同一套合成代码。
 */

export {
  MAX_OVERLAY_LAYERS,
  hitTest,
  isActiveAt,
  isTrackRenderable,
  renderFrame,
  sourceTimeMs,
  type FrameGetter,
  type RenderOptions,
} from './compositor.js';
export { computeFitRect, drawImageLayer, type DrawImageOptions, type FitRect } from './drawImage.js';
export {
  buildFontString,
  drawTextLayer,
  measureTextBlock,
  type DrawTextOptions,
  type TextBlockMetrics,
} from './drawText.js';
export { applyCornerRadius, applyTransform, type TransformApplyOptions } from './drawTransform.js';
export {
  DEFAULT_FRAME_CACHE_CAPACITY,
  FRAME_BUCKET_MS,
  FrameCache,
  globalFrameCache,
} from './frameCache.js';
