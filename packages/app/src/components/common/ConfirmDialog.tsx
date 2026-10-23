/**
 * 二次确认对话框（删除工程 / 删除轨道 / 删除素材）。
 */

import type { ReactNode } from 'react';
import { Dialog } from './Dialog.js';
import { Button } from './Button.js';

/** ConfirmDialog 属性。 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

/** 二次确认对话框。 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  children,
}: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description ? { description } : {})}
      className="w-[min(420px,92vw)]"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
