/**
 * 3s 撤销提示条（删除 clip 场景）。
 */

import { useEffect, useState } from 'react';
import { Button } from './Button.js';

/** UndoToast 属性。 */
export interface UndoToastProps {
  /** 提示文案 */
  message: string;
  /** 撤销回调 */
  onUndo: () => void;
  /** 持续时长（毫秒），默认 3000 */
  durationMs?: number;
  /** 关闭回调 */
  onDismiss?: () => void;
}

/** 撤销提示条。 */
export function UndoToast({
  message,
  onUndo,
  durationMs = 3000,
  onDismiss,
}: UndoToastProps): JSX.Element | null {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, onDismiss]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-10 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-3 rounded-md border border-[var(--cc-border-strong)] bg-[var(--cc-bg-elevated)] px-3 py-2 text-xs shadow-xl">
      <span className="text-[var(--cc-fg-secondary)]">{message}</span>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          onUndo();
          setVisible(false);
          onDismiss?.();
        }}
      >
        撤销
      </Button>
    </div>
  );
}
