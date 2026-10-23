/**
 * 预览 `<canvas>`：承载合成器输出，支持点击选中画面上的 clip。
 */

import { useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../../state/projectStore.js';
import { useUiStore } from '../../state/uiStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { renderFrame } from '../../render/compositor.js';
import { useRenderLoop } from '../../hooks/useRenderLoop.js';
import { clsx } from '../../utils/clsx.js';

/** PreviewCanvas 属性。 */
export interface PreviewCanvasProps {
  /** 画布缩放模式。 */
  zoomMode: 'fit' | 'fill' | 'original';
  className?: string;
}

/**
 * 预览画布。
 */
export function PreviewCanvas({ zoomMode, className }: PreviewCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doc = useProjectStore((state) => state.doc);
  const selectedClipIds = useUiStore((state) => state.selectedClipIds);
  const setSelectedClipIds = useUiStore((state) => state.setSelectedClipIds);

  const draw = useCallback(
    (timeMs: number): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderFrame(ctx, doc, timeMs);
    },
    [doc],
  );

  useRenderLoop({ onFrame: draw });

  // 文档变化时立即重绘一帧
  useEffect(() => {
    draw(usePlaybackStore.getState().currentTimeMs);
  }, [draw]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    // 命中测试：从上到下找最上层的 clip
    const timeMs = usePlaybackStore.getState().currentTimeMs;
    const candidates = doc.tracks
      .filter((track) => !track.hidden)
      .flatMap((track) => track.clips)
      .filter((clip) => clip.assetId !== null)
      .filter(
        (clip) => timeMs >= clip.startMs && timeMs < clip.startMs + clip.durationMs,
      )
      .sort((a, b) => b.zIndex - a.zIndex);

    for (const clip of candidates) {
      const centerX = clip.transform.x * doc.settings.canvas.width;
      const centerY = clip.transform.y * doc.settings.canvas.height;
      const halfWidth = (doc.settings.canvas.width / 2) * clip.transform.scale;
      const halfHeight = (doc.settings.canvas.height / 2) * clip.transform.scale;
      if (
        x >= centerX - halfWidth &&
        x <= centerX + halfWidth &&
        y >= centerY - halfHeight &&
        y <= centerY + halfHeight
      ) {
        setSelectedClipIds([clip.id]);
        return;
      }
    }
    setSelectedClipIds([]);
  };

  const canvasWidth = doc.settings.canvas.width;
  const canvasHeight = doc.settings.canvas.height;

  return (
    <div className={clsx('flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-3', className)}>
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        onClick={handleClick}
        className={clsx(
          'max-h-full max-w-full bg-black shadow-lg',
          zoomMode === 'fit' && 'object-contain',
          zoomMode === 'fill' && 'object-cover',
          zoomMode === 'original' && 'object-contain',
        )}
        style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
        aria-label="preview"
      />
      {selectedClipIds.length === 0 ? null : null}
    </div>
  );
}
