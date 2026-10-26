/**
 * 滤镜预设 → Canvas 2D `ctx.filter` CSS 字符串映射。
 *
 * 预览与导出共用同一份映射（合成器是唯一合成入口），保证「所见即所得」。
 * `intensity` 为 0~1 强度系数：0 等效于无滤镜，1 为预设满效果。
 */

import type { ClipFilter, FilterPresetId } from '@clipcut/shared-types';

/** 强度插值助手：把 0~1 的强度线性映射到 [base, full]。 */
function lerp(base: number, full: number, k: number): number {
  return base + (full - base) * k;
}

/**
 * 预设表：每个预设是一个「强度 → CSS filter 函数」的生成器。
 *
 * 说明：
 * - `sharp` 用对比度增强模拟锐化（Canvas 2D 无真正的 sharpen 卷积）；
 * - `cool` / `warm` 用 hue-rotate + saturate 近似色温偏移；
 * - `vintage` 用 sepia + 降对比模拟褪色老电影。
 */
const FILTER_BUILDERS: Record<Exclude<FilterPresetId, 'none'>, (k: number) => string> = {
  vivid: (k) => `saturate(${lerp(1, 1.6, k).toFixed(3)}) contrast(${lerp(1, 1.12, k).toFixed(3)})`,
  mono: (k) => `grayscale(${k.toFixed(3)})`,
  vintage: (k) =>
    `sepia(${lerp(0, 0.55, k).toFixed(3)}) contrast(${lerp(1, 0.92, k).toFixed(3)}) brightness(${lerp(1, 1.05, k).toFixed(3)})`,
  cool: (k) => `hue-rotate(${lerp(0, -12, k).toFixed(2)}deg) saturate(${lerp(1, 1.25, k).toFixed(3)})`,
  warm: (k) => `sepia(${lerp(0, 0.28, k).toFixed(3)}) saturate(${lerp(1, 1.35, k).toFixed(3)})`,
  fade: (k) =>
    `contrast(${lerp(1, 0.82, k).toFixed(3)}) brightness(${lerp(1, 1.08, k).toFixed(3)}) saturate(${lerp(1, 0.75, k).toFixed(3)})`,
  sharp: (k) => `contrast(${lerp(1, 1.25, k).toFixed(3)}) saturate(${lerp(1, 1.05, k).toFixed(3)})`,
};

/** 预设 id 列表（不含 `none`，供 UI 遍历）。 */
export const FILTER_PRESET_IDS: ReadonlyArray<Exclude<FilterPresetId, 'none'>> = [
  'vivid',
  'mono',
  'vintage',
  'cool',
  'warm',
  'fade',
  'sharp',
];

/**
 * 把 clip 滤镜映射为 `ctx.filter` 可用的 CSS 字符串。
 *
 * 无滤镜 / 强度为 0 / 未知预设 → `'none'`（赋值即清空滤镜）。
 */
export function clipFilterCss(filter: ClipFilter | undefined): string {
  if (!filter) return 'none';
  if (filter.preset === 'none') return 'none';
  const builder = FILTER_BUILDERS[filter.preset];
  if (!builder) return 'none';
  const k = Math.min(1, Math.max(0, filter.intensity));
  if (k <= 0) return 'none';
  return builder(k);
}
