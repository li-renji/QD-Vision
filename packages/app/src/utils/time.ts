/**
 * UI 时间格式化工具（与 `shared-types/time.ts` 的区别：此处面向展示与本地化）。
 */

import { formatDuration, formatTimecode, msToFrames } from '@clipcut/shared-types';

/** `mm:ss` 短时长。 */
export function formatShortDuration(ms: number): string {
  return formatDuration(ms);
}

/** `HH:MM:SS:FF` 时间码。 */
export function formatTimecodeMs(ms: number, fps: number): string {
  return formatTimecode(ms, fps);
}

/** 帧号 → `HH:MM:SS:FF`。 */
export function formatFrameTimecode(frame: number, fps: number): string {
  return formatTimecode(Math.round((frame / Math.max(1, fps)) * 1000), fps);
}

/** 毫秒 → 帧号。 */
export function toFrame(ms: number, fps: number): number {
  return msToFrames(ms, fps);
}

/** 帧号 → 毫秒。 */
export function fromFrame(frame: number, fps: number): number {
  return Math.round((frame / Math.max(1, fps)) * 1000);
}

/** 像素 ↔ 毫秒（按缩放比例）。 */
export function pxToMs(px: number, pxPerSecond: number): number {
  if (pxPerSecond <= 0) return 0;
  return Math.round((px / pxPerSecond) * 1000);
}

/** 毫秒 → 像素（按缩放比例）。 */
export function msToPx(ms: number, pxPerSecond: number): number {
  return (ms / 1000) * pxPerSecond;
}
