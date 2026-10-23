/**
 * Tabs 组件（自研，无额外依赖）。
 *
 * 说明：架构选型只允许引入 5 个 Radix 原语（dialog / dropdown-menu /
 * context-menu / tooltip / slider），Tabs 因此自研实现，保持依赖面最小。
 */

import { useId, type ReactNode } from 'react';
import { clsx } from '../../utils/clsx.js';

/** 单个标签页。 */
export interface TabItem {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** Tabs 属性。 */
export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  children?: ReactNode;
  className?: string;
  /** 紧凑模式（用于设置面板的侧边 tab） */
  variant?: 'top' | 'side';
}

/**
 * Tabs。
 */
export function Tabs({
  value,
  onValueChange,
  items,
  children,
  className,
  variant = 'top',
}: TabsProps): JSX.Element {
  const baseId = useId();

  return (
    <div
      className={clsx(variant === 'side' ? 'flex gap-2' : 'flex flex-col', className)}
      role="tablist"
    >
      <div
        className={clsx(
          'flex',
          variant === 'side'
            ? 'flex-col gap-1 border-r border-[var(--cc-border)] pr-2'
            : 'gap-1 border-b border-[var(--cc-border)]',
        )}
      >
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel-${item.value}`}
              disabled={item.disabled}
              onClick={() => onValueChange(item.value)}
              className={clsx(
                'px-3 py-1.5 text-xs transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-40',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cc-accent)]',
                active
                  ? 'rounded bg-[var(--cc-bg-elevated)] text-[var(--cc-fg-primary)]'
                  : 'text-[var(--cc-fg-muted)] hover:text-[var(--cc-fg-secondary)]',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div className={clsx(variant === 'side' ? 'flex-1 overflow-y-auto' : 'flex-1')}>
        {children}
      </div>
    </div>
  );
}

/** Tabs 内容面板。 */
export function TabPanel({ value, children }: { value: string; children: ReactNode }): JSX.Element {
  return (
    <div role="tabpanel" data-value={value} className="outline-none">
      {children}
    </div>
  );
}
