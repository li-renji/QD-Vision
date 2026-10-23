/**
 * clip 内的波形绘制。
 *
 * 按 `assetId + 宽度桶` 缓存 `OffscreenCanvas`，跨桶才重绘（缩放不卡顿）。
 */

import { memo, useEffect, useRef } from 'react';
import type { Asset } from '@clipcut/shared-types';

/** 宽度桶（像素）。 */
const WIDTH_BUCKETS = [40, 80, 160, 320, 640, 1280];

/** 波形缓存。 */
const cache = new Map<string, OffscreenCanvas | HTMLCanvasElement>();

/** 取合适的宽度桶。 */
function bucketFor(widthPx: number): number {
  for (const bucket of WIDTH_BUCKETS) {
    if (widthPx <= bucket) return bucket;
  }
  return WIDTH_BUCKETS[WIDTH_BUCKETS.length - 1] ?? 1280;
}

/** WaveformCanvas 属性。 */
export interface WaveformCanvasProps {
  asset: Asset;
  /** 显示宽度（像素） */
  widthPx: number;
  /** 显示高度（像素） */
  heightPx: number;
  /** 颜色 */
  color?: string;
}

/**
 * 波形画布。
 */
export const WaveformCanvas = memo(function WaveformCanvas({
  asset,
  widthPx,
  heightPx,
  color = 'rgba(255,255,255,0.55)',
}: WaveformCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const waveform = asset.waveform;
    if (!waveform || waveform.length === 0) return;

    const bucket = bucketFor(widthPx);
    const key = `${asset.id}@${bucket}`;

    let source = cache.get(key);
    if (!source) {
      const offscreen =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(bucket, heightPx)
          : Object.assign(document.createElement('canvas'), { width: bucket, height: heightPx });
      const ctx = offscreen.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (ctx) {
        ctx.clearRect(0, 0, bucket, heightPx);
        ctx.fillStyle = color;
        const step = waveform.length / bucket;
        for (let x = 0; x < bucket; x += 1) {
          const start = Math.floor(x * step);
          const end = Math.max(start + 1, Math.floor((x + 1) * step));
          let peak = 0;
          for (let i = start; i < end && i < waveform.length; i += 1) {
            peak = Math.max(peak, waveform[i] ?? 0);
          }
          const h = Math.max(1, peak * heightPx);
          ctx.fillRect(x, (heightPx - h) / 2, 1, h);
        }
        cache.set(key, offscreen);
      }
      source = offscreen;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx || !source) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  }, [asset, widthPx, heightPx, color]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(1, Math.floor(widthPx))}
      height={Math.max(1, Math.floor(heightPx))}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
});
