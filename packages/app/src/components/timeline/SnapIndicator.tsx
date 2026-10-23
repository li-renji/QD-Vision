/**
 * 吸附参考线高亮层。
 *
 * 独立 overlay 层，不进入 clip 渲染（ARCHITECTURE §8.3 ②）。
 */

import { useUiStore } from '../../state/uiStore.js';

/** SnapIndicator 属性。 */
export interface SnapIndicatorProps {
  /** 内容区宽度（像素） */
  widthPx?: number | undefined;
}

/**
 * 吸附参考线。
 */
export function SnapIndicator({ widthPx: _widthPx }: SnapIndicatorProps): JSX.Element | null {
  const dragSession = useUiStore((state) => state.dragSession);
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);

  if (!dragSession || dragSession.snapMs === null) return null;

  const x = (dragSession.snapMs / 1000) * pxPerSecond;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-30 w-px bg-[var(--cc-success)]"
      style={{ transform: `translateX(${x}px)` }}
      aria-hidden="true"
    />
  );
}
