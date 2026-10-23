/**
 * rAF 渲染循环：驱动预览合成。
 *
 * 关键性能约束（ARCHITECTURE §8.3）：
 * - `playbackStore.currentTimeMs` 通过**命令式**通道读取，**不触发 React 重渲染**；
 * - 仅在时间变化超过 1 帧时才重绘（避免暂停时空转 60fps 烧 CPU）。
 *
 * ⚠️ **阈值陷阱（已修复）**：旧实现只在 `|Δt| >= frameMs * 0.5` 时重绘。
 * 播放时钟推进的步长恰好与该阈值同量级（30fps 时 16.6ms vs 阈值 16.67ms），
 * 一旦时钟步进略小于阈值就会**漏帧**——表现为「播放头在动但画面卡住」。
 * 现在改为：只要时间**真的变了**（`Δt > 0`）就重绘，语义与性能都正确。
 */

import { useEffect, useRef } from 'react';
import { usePlaybackStore } from '../state/playbackStore.js';

/** 渲染循环参数。 */
export interface RenderLoopOptions {
  /** 每帧回调（时间变化时触发）。 */
  onFrame: (timeMs: number) => void;
  /** 是否启用。 */
  enabled?: boolean;
}

/**
 * 启动 rAF 渲染循环。
 */
export function useRenderLoop(options: RenderLoopOptions): void {
  const { onFrame, enabled = true } = options;
  const callbackRef = useRef(onFrame);
  const lastRenderedRef = useRef<number>(-1);

  useEffect(() => {
    callbackRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!enabled) return;

    let rafId = 0;

    const tick = (): void => {
      const state = usePlaybackStore.getState();
      const timeMs = state.currentTimeMs;
      const frameMs = state.frameDurationMs;

      // 时间只要真的变了就重绘。
      // 播放时额外用 `frameMs` 兜底：即便某一帧时钟没推进（如 seek 对齐），
      // 也保证画面与最新状态一致。
      const timeChanged = timeMs !== lastRenderedRef.current;
      const frameElapsed =
        Math.abs(timeMs - lastRenderedRef.current) >= frameMs * 0.5;

      if (timeChanged && (state.isPlaying || frameElapsed || lastRenderedRef.current < 0)) {
        lastRenderedRef.current = timeMs;
        callbackRef.current(timeMs);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}