/**
 * 播放头：拖拽定位，播放时**直接改 `style.transform`**（不触发 React 重渲染）。
 */

import { useEffect, useRef } from 'react';
import { useUiStore } from '../../state/uiStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';

/** Playhead 属性。 */
export interface PlayheadProps {
  /** 内容区宽度（像素） */
  widthPx: number;
}

/**
 * 播放头。
 */
export function Playhead({ widthPx }: PlayheadProps): JSX.Element {
  const lineRef = useRef<HTMLDivElement | null>(null);
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const setCurrentTimeMs = usePlaybackStore((state) => state.setCurrentTime);

  useEffect(() => {
    const update = (timeMs: number): void => {
      const line = lineRef.current;
      if (!line) return;
      line.style.transform = `translateX(${(timeMs / 1000) * pxPerSecond}px)`;
    };

    update(usePlaybackStore.getState().currentTimeMs);
    return usePlaybackStore.subscribe((state) => update(state.currentTimeMs));
  }, [pxPerSecond]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      const rect = element.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const x = moveEvent.clientX - rect.left;
      setCurrentTimeMs(Math.max(0, (x / pxPerSecond) * 1000));
    };

    const up = (): void => {
      window.removeEventListener('pointermove', move);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 z-20"
      style={{ width: widthPx }}
      aria-hidden="true"
    >
      <div
        ref={lineRef}
        className="pointer-events-auto absolute inset-y-0 left-0 w-px bg-[var(--cc-danger)]"
        onPointerDown={handlePointerDown}
        role="presentation"
      >
        <div className="absolute -left-[5px] top-0 h-0 w-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-[var(--cc-danger)]" />
      </div>
    </div>
  );
}
