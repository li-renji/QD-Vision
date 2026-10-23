/**
 * rAF 渲染循环：驱动预览合成。
 *
 * 关键性能约束（ARCHITECTURE §8.3）：
 * - `playbackStore.currentTimeMs` 通过**命令式**通道读取，**不触发 React 重渲染**；
 * - 仅在时间变化超过 1 帧时才重绘。
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

      // 仅在时间变化超过 1 帧时重绘
      if (Math.abs(timeMs - lastRenderedRef.current) >= frameMs * 0.5) {
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
