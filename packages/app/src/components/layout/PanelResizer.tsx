/**
 * 面板拖拽分隔条（侧栏 / 属性面板宽度）。
 */

import { useCallback, useRef } from 'react';
import { useUiStore } from '../../state/uiStore.js';

/** PanelResizer 属性。 */
export interface PanelResizerProps {
  /** 调整哪个面板的宽度。 */
  target: 'media' | 'inspector';
  /** 分隔条方向。 */
  direction: 'left' | 'right';
}

/**
 * 面板拖拽分隔条。
 *
 * 拖拽期间只改 DOM style，抬手时提交到 `uiStore`（不产生历史记录）。
 */
export function PanelResizer({ target, direction }: PanelResizerProps): JSX.Element {
  const startRef = useRef({ x: 0, width: 0 });

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const element = event.currentTarget;
      const ui = useUiStore.getState();
      const startWidth = ui.panelWidths[target];
      startRef.current = { x: event.clientX, width: startWidth };

      const onMove = (moveEvent: PointerEvent): void => {
        const delta = moveEvent.clientX - startRef.current.x;
        const next = direction === 'right' ? startRef.current.width + delta : startRef.current.width - delta;
        element.style.setProperty('--cc-resize-preview', `${Math.max(160, next)}px`);
      };

      const onUp = (): void => {
        const preview = element.style.getPropertyValue('--cc-resize-preview');
        element.style.removeProperty('--cc-resize-preview');
        const next = Number.parseFloat(preview);
        if (Number.isFinite(next)) {
          useUiStore.getState().setPanelWidth(target, next);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
      window.addEventListener('pointercancel', onUp, { once: true });
    },
    [target, direction],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--cc-accent)]"
    />
  );
}
