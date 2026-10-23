/**
 * 预览 `<canvas>`：承载合成器输出，支持点击选中画面上的 clip。
 *
 * ## 取帧接线（预览全黑的根因修复）
 *
 * 过去这里调用的是 `renderFrame(ctx, doc, timeMs)` —— **不传 `getFrame`**，
 * 于是 `compositor.drawVideoClip` 在 `if (!getFrame) return;` 处直接返回，
 * 视频图层永不绘制，画布只剩背景色。
 *
 * 现在通过 {@link PreviewFrameSource} 注入 `getFrame`：它在 IndexedDB 里取素材字节
 * → 建 `<video>` / `<img>` → 异步 `createImageBitmap` 写帧缓存，
 * 合成器的**同步** `getFrame` 调用因此能立即拿到 `ImageBitmap`。
 *
 * 该模块是纯服务层，不感知 React；组件只负责生命周期与重绘触发。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useProjectStore } from '../../state/projectStore.js';
import { useUiStore } from '../../state/uiStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { renderFrame } from '../../render/compositor.js';
import { useRenderLoop } from '../../hooks/useRenderLoop.js';
import { usePreviewAudio } from '../../hooks/usePreviewAudio.js';
import { setActivePreviewAudio } from '../../services/media/previewAudio.js';
import { createPreviewFrameSource } from '../../services/media/previewFrameSource.js';
import { getBlobByKey } from '../../services/storage/blobRepo.js';
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

  /**
   * 预览取帧器：整个组件生命周期内**只创建一次**（StrictMode 下也只创建一次，
   * 避免重复建video 元素与 objectURL）。
   */
  const frameSource = useMemo(
    () =>
      createPreviewFrameSource({
        // 素材字节只走 blobRepo（IndexedDB 封装）—— 组件层不碰 window.indexedDB
        readAssetBlob: (asset) =>
          asset.blobKey ? getBlobByKey(asset.blobKey) : Promise.resolve(null),
      }),
    [],
  );

  const draw = useCallback(
    (timeMs: number): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderFrame(ctx, doc, timeMs, { getFrame: frameSource.getFrame });
    },
    [doc, frameSource],
  );

  /**
   * 预览音频接线（**「没有声音」的修复点**）。
   *
   * 音频复用 `frameSource` 持有的 `<video>` 元素建WebAudio 混音图，
   * 与画面走同一个 `usePlaybackStore` 时钟 —— 见 `usePreviewAudio.ts`。
   */
  const { controller } = usePreviewAudio(frameSource);

  /**
   * 把控制器登记为「当前预览音频」。
   *
   * 播放按钮（`PreviewControls` / `TopToolbar`）需要在**用户手势调用栈内**
   * 调 `unlock()` 才能绕过浏览器自动播放策略；把控制器登记成模块级单例，
   * 按钮就不必层层透传 props。
   */
  useEffect(() => {
    setActivePreviewAudio(controller);
    return () => {
      setActivePreviewAudio(null);
    };
  }, [controller]);

  useRenderLoop({ onFrame: draw });

  // 文档变化时立即重绘一帧
  useEffect(() => {
    draw(usePlaybackStore.getState().currentTimeMs);
  }, [draw]);

  // 素材集合变化 → 登记新素材（异步准备 blob → objectURL → 媒体元素）
  useEffect(() => {
    for (const asset of Object.values(doc.assets)) {
      void frameSource.ensureAsset(asset);
    }
  }, [doc.assets, frameSource]);

  // 异步帧就绪 → 立刻重绘，让新画面马上出现
  useEffect(() => {
    return frameSource.onFrameReady(() => {
      draw(usePlaybackStore.getState().currentTimeMs);
    });
  }, [draw, frameSource]);

  // 播放 / 暂停 / 变速 → 同步到 <video> 元素（命令式，不触发重渲染）
  useEffect(() => {
    const apply = (state: { isPlaying: boolean; playbackRate: number }): void => {
      frameSource.setPlaying(state.isPlaying);
      frameSource.setPlaybackRate(state.playbackRate);
    };
    apply(usePlaybackStore.getState());
    return usePlaybackStore.subscribe((state) => {
      apply(state);
    });
  }, [frameSource]);

  // 卸载时释放：revokeObjectURL + videoPool.dispose() + close(bitmap)
  useEffect(() => {
    return () => {
      frameSource.dispose();
    };
  }, [frameSource]);

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