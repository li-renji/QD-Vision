/**
 * 时间标尺：刻度随缩放自适应（ms / s / min），点击跳转、拖拽播放头。
 */

import { useMemo } from 'react';
import { useUiStore } from '../../state/uiStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';

/** 标尺刻度。 */
export interface RulerTick {
  /** 时间（毫秒） */
  ms: number;
  /** 像素位置 */
  x: number;
  /** 主刻度（带文字） */
  major: boolean;
  /** 标签 */
  label: string;
}

/** 时间步长档位。 */
const TICK_STEPS = [100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000];

/**
 * 计算标尺刻度。
 */
export function computeTicks(pxPerSecond: number, widthPx: number): RulerTick[] {
  const targetPx = 90;
  const minStepMs = (targetPx / pxPerSecond) * 1000;
  const step = TICK_STEPS.find((value) => value >= minStepMs) ?? TICK_STEPS[TICK_STEPS.length - 1] ?? 1000;

  const ticks: RulerTick[] = [];
  const totalMs = (widthPx / pxPerSecond) * 1000;

  for (let ms = 0; ms <= totalMs; ms += step) {
    const x = (ms / 1000) * pxPerSecond;
    const major = step >= 1000 ? ms % (step * (step >= 10_000 ? 6 : 5)) === 0 : true;
    ticks.push({ ms, x, major, label: formatTickLabel(ms, step) });
  }
  return ticks;
}

/** 刻度标签。 */
function formatTickLabel(ms: number, step: number): string {
  if (step < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  if (step < 60_000) {
    return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** TimelineRuler 属性。 */
export interface TimelineRulerProps {
  /** 视口宽度（像素） */
  widthPx: number;
}

/**
 * 时间标尺。
 */
export function TimelineRuler({ widthPx }: TimelineRulerProps): JSX.Element {
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const scrollLeft = useUiStore((state) => state.scrollLeft);
  const setCurrentTimeMs = usePlaybackStore((state) => state.setCurrentTime);

  const ticks = useMemo(() => computeTicks(pxPerSecond, widthPx), [pxPerSecond, widthPx]);

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ms = Math.max(0, (x / pxPerSecond) * 1000);
    setCurrentTimeMs(ms);
  };

  return (
    <div
      className="relative h-6 shrink-0 cursor-pointer border-b border-[var(--cc-border)] bg-[var(--cc-bg-elevated)]"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        handlePointer(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) handlePointer(event);
      }}
      role="slider"
      aria-label="timeline ruler"
      aria-valuemin={0}
      aria-valuenow={0}
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{ transform: `translateX(${-scrollLeft}px)`, width: widthPx }}
      >
        {ticks.map((tick) => (
          <div
            key={tick.ms}
            className="absolute bottom-0 top-0"
            style={{ left: `${tick.x}px` }}
          >
            <div
              className={
                tick.major
                  ? 'absolute bottom-0 h-2 w-px bg-[var(--cc-fg-muted)]'
                  : 'absolute bottom-0 h-1 w-px bg-[var(--cc-border-strong)]'
              }
            />
            {tick.major ? (
              <span className="absolute left-1 top-0 font-mono text-[9px] text-[var(--cc-fg-muted)]">
                {tick.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
