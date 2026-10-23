/**
 * Radix Dialog 封装（模态、ESC 关闭、焦点陷阱）。
 */

import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { clsx } from '../../utils/clsx.js';

/** 对话框属性。 */
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** 对话框。 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps): JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <DialogPrimitive.Content
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-[var(--cc-border)] bg-[var(--cc-bg-panel)] p-4 shadow-2xl',
            className,
          )}
        >
          <DialogPrimitive.Title className="text-sm font-semibold text-[var(--cc-fg-primary)]">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1 text-xs text-[var(--cc-fg-secondary)]">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          <div className="mt-3 max-h-[70vh] overflow-y-auto">{children}</div>
          {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 text-[var(--cc-fg-muted)] hover:text-[var(--cc-fg-primary)]"
          >
            ×
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
