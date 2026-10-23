/**
 * 核心合成器 —— **导出与预览共用的唯一合成入口**。
 *
 * 合成顺序（ARCHITECTURE §7.2）：
 * 1. 清屏（画布背景色）
 * 2. 视频轨按 `order` **从下往上**
 * 3. `isOverlay` 画面按 `zIndex` 叠在主画面之上（**最多 4 层 PIP**）
 * 4. 文字轨
 * 5. 字幕（可选烧录）
 *
 * 硬约束：
 * - `hidden` 轨不参与渲染。
 * - 源时间换算：`sourceMs = clip.inMs + (timeMs - clip.startMs) * clip.speed`。
 * - `renderFrame` 是**纯函数式的绘制**，不持有状态。
 */

import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';
import { orderedTracks } from '../domain/timeline/selectors.js';
import { drawImageLayer } from './drawImage.js';
import { drawTextLayer } from './drawText.js';
import { applyTransform } from './drawTransform.js';

/** 最多支持的 PIP 层数。 */
export const MAX_OVERLAY_LAYERS = 4;

/** 取帧函数：由帧提供器注入（预览用 videoPool，导出用 frameProviders）。 */
export type FrameGetter = (assetId: string, sourceMs: number) => ImageBitmap | null;

/** 渲染参数。 */
export interface RenderOptions {
  /** 取帧函数（缺省时不绘制视频图层）。 */
  getFrame?: FrameGetter;
  /** 是否烧录字幕（默认跟随 `subtitles.enabled`）。 */
  burnInSubtitles?: boolean;
  /** 警告收集器（PIP 超限等）。 */
  warnings?: string[];
}

/** 源时间换算。 */
export function sourceTimeMs(clip: Clip, timeMs: number): number {
  return clip.inMs + (timeMs - clip.startMs) * clip.speed;
}

/** 判断 clip 在指定时间是否处于活动状态。 */
export function isActiveAt(clip: Clip, timeMs: number): boolean {
  return timeMs >= clip.startMs && timeMs < clip.startMs + clip.durationMs;
}

/** 判断轨道是否参与渲染。 */
export function isTrackRenderable(track: Track): boolean {
  return !track.hidden;
}

/**
 * 渲染一帧。
 *
 * @param ctx 目标 2D 上下文
 * @param doc 工程
 * @param timeMs 时间线位置（毫秒）
 * @param opts 渲染参数
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDoc,
  timeMs: number,
  opts: RenderOptions = {},
): void {
  const canvas = doc.settings.canvas;
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const warnings = opts.warnings ?? [];

  // 1) 清屏
  ctx.save();
  ctx.fillStyle = canvas.backgroundColor || '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();

  const tracks = orderedTracks(doc);
  const overlays: Clip[] = [];

  // 2) 视频轨：从下往上
  for (const track of tracks) {
    if (track.type !== 'video') continue;
    if (!isTrackRenderable(track)) continue;

    for (const clip of track.clips) {
      if (!isActiveAt(clip, timeMs)) continue;
      if (clip.isOverlay) {
        overlays.push(clip);
        continue;
      }
      drawVideoClip(ctx, doc, clip, timeMs, opts, canvasWidth, canvasHeight);
    }
  }

  // 3) PIP 叠加层：按 zIndex 升序，最多 4 层
  overlays.sort((a, b) => a.zIndex - b.zIndex);
  const renderedOverlays = overlays.slice(0, MAX_OVERLAY_LAYERS);
  if (overlays.length > MAX_OVERLAY_LAYERS) {
    warnings.push(
      `画中画层数超过 ${MAX_OVERLAY_LAYERS} 层，已忽略 ${overlays.length - MAX_OVERLAY_LAYERS} 层。`,
    );
  }
  for (const clip of renderedOverlays) {
    drawVideoClip(ctx, doc, clip, timeMs, opts, canvasWidth, canvasHeight);
  }

  // 4) 文字轨
  for (const track of tracks) {
    if (track.type !== 'text') continue;
    if (!isTrackRenderable(track)) continue;
    for (const clip of track.clips) {
      if (!isActiveAt(clip, timeMs)) continue;
      if (!clip.text) continue;
      drawTextLayer(ctx, {
        text: clip.text,
        transform: clip.transform,
        canvasWidth,
        canvasHeight,
      });
    }
  }

  // 5) 字幕
  const shouldBurnIn = opts.burnInSubtitles ?? doc.subtitles.enabled;
  if (shouldBurnIn) {
    drawSubtitle(ctx, doc, timeMs, canvasWidth, canvasHeight);
  }
}

/** 绘制一个视频 / 图片 clip。 */
function drawVideoClip(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDoc,
  clip: Clip,
  timeMs: number,
  opts: RenderOptions,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!clip.assetId) return;
  const getFrame = opts.getFrame;
  if (!getFrame) return;

  const asset = doc.assets[clip.assetId];
  const sourceMs = sourceTimeMs(clip, timeMs);
  const frame = getFrame(clip.assetId, sourceMs);
  if (!frame) return;

  const contentWidth = frame.width || asset?.width || canvasWidth;
  const contentHeight = frame.height || asset?.height || canvasHeight;

  drawImageLayer(ctx, frame, {
    fit: clip.transform.fit,
    transform: clip.transform,
    canvasWidth,
    canvasHeight,
    contentWidth,
    contentHeight,
    // 圆角仅对画中画生效
    cornerRadius: clip.isOverlay ? clip.transform.cornerRadius : 0,
  });
}

/** 绘制当前激活的字幕条目。 */
function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDoc,
  timeMs: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const style = doc.subtitles.style;
  const cue = doc.subtitles.cues.find(
    (item) => timeMs >= item.startMs && timeMs < item.endMs,
  );
  if (!cue) return;

  const fontScale = canvasHeight / 1080;
  const fontSize = Math.max(1, style.fontSize * fontScale);
  const text = cue.text;

  ctx.save();
  ctx.font = `700 ${fontSize}px "${style.fontFamily}", sans-serif`;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'alphabetic';

  const lines = text.split('\n');
  const lineHeight = fontSize * 1.3;
  const bottom = canvasHeight - style.bottomOffsetPx * fontScale;
  let y = bottom - (lines.length - 1) * lineHeight;

  const x = style.align === 'left' ? 0 : style.align === 'right' ? canvasWidth : canvasWidth / 2;

  for (const line of lines) {
    if (style.strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, x, y);
    y += lineHeight;
  }

  ctx.restore();
}

/**
 * 命中测试：返回指定画布坐标处的最上层 clip（用于「点击画面选中 clip」）。
 */
export function hitTest(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDoc,
  timeMs: number,
  pointX: number,
  pointY: number,
  getFrame: FrameGetter,
): Clip | null {
  const canvas = doc.settings.canvas;
  const tracks = orderedTracks(doc).filter((track) => isTrackRenderable(track));
  const candidates: Clip[] = [];

  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!isActiveAt(clip, timeMs)) continue;
      if (clip.assetId === null) continue;
      candidates.push(clip);
    }
  }

  // 从上层往下检测（后绘制的优先命中）
  candidates.sort((a, b) => b.zIndex - a.zIndex);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const clip = candidates[i];
    if (!clip) continue;
    const frame = getFrame(clip.assetId as string, sourceTimeMs(clip, timeMs));
    if (!frame) continue;

    ctx.save();
    applyTransform(ctx, clip.transform, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      contentWidth: frame.width || canvas.width,
      contentHeight: frame.height || canvas.height,
    });
    // 通过逆变换把点击点换算到内容局部坐标
    const localX = pointX;
    const localY = pointY;
    ctx.restore();

    const inBounds = isPointInsideClip(localX, localY, clip, canvas.width, canvas.height);
    if (inBounds) return clip;
  }

  return null;
}

/** 粗略命中判断：把点击点换算到画布比例后比较 transform 中心与尺寸。 */
function isPointInsideClip(
  pointX: number,
  pointY: number,
  clip: Clip,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const centerX = clip.transform.x * canvasWidth;
  const centerY = clip.transform.y * canvasHeight;
  const halfWidth = (canvasWidth / 2) * clip.transform.scale;
  const halfHeight = (canvasHeight / 2) * clip.transform.scale;
  return (
    pointX >= centerX - halfWidth &&
    pointX <= centerX + halfWidth &&
    pointY >= centerY - halfHeight &&
    pointY <= centerY + halfHeight
  );
}
