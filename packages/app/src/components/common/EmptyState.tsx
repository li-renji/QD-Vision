/**
 * 空状态占位。
 */

import type { ReactNode } from 'react';

/** EmptyState 属性。 */
export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/** 空状态。 */
export function EmptyState({ title, description, action, icon }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {icon ? <div className="text-3xl opacity-40">{icon}</div> : null}
      <div className="text-sm text-[var(--cc-fg-secondary)]">{title}</div>
      {description ? (
        <div className="max-w-sm text-xs text-[var(--cc-fg-muted)]">{description}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
