/**
 * 画布比例变更时的等比换算（PRD §4.1 / FR-026①）。
 *
 * - `transform.x` 按 **新画布宽 / 旧画布宽** 换算；
 * - `transform.y` 按 **新画布高 / 旧画布高** 换算；
 * - `text.fontSize` 按 **新画布高 / 1080** 换算（字号以 1080p 为参考像素）。
 */

import { REFERENCE_CANVAS_HEIGHT, type ProjectDoc } from '@clipcut/shared-types';

/** 画布尺寸变更结果。 */
export interface CanvasResizeResult {
  /** 变更后的工程（不可变更新）。 */
  doc: ProjectDoc;
  /** 宽度缩放系数。 */
  scaleX: number;
  /** 高度缩放系数。 */
  scaleY: number;
  /** 字号缩放系数（相对 1080p 参考高度）。 */
  fontScale: number;
}

/**
 * 应用画布尺寸变更。
 */
export function applyCanvasResize(doc: ProjectDoc, newWidth: number, newHeight: number): CanvasResizeResult {
  const oldWidth = doc.settings.canvas.width;
  const oldHeight = doc.settings.canvas.height;

  const scaleX = oldWidth > 0 ? newWidth / oldWidth : 1;
  const scaleY = oldHeight > 0 ? newHeight / oldHeight : 1;
  const fontScale = newHeight / REFERENCE_CANVAS_HEIGHT;

  const next: ProjectDoc = {
    ...doc,
    settings: {
      ...doc.settings,
      canvas: {
        ...doc.settings.canvas,
        width: newWidth,
        height: newHeight,
      },
    },
    tracks: doc.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        ...clip,
        transform: {
          ...clip.transform,
          x: clip.transform.x * scaleX,
          y: clip.transform.y * scaleY,
        },
        ...(clip.text
          ? {
              text: {
                ...clip.text,
                fontSize: clip.text.fontSize * fontScale,
              },
            }
          : {}),
      })),
    })),
  };

  return { doc: next, scaleX, scaleY, fontScale };
}
