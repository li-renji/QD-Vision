/**
 * Radix DropdownMenu 封装的选择器。
 */

import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { clsx } from '../../utils/clsx.js';

/** 选项。 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Select 属性。 */
export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  /**
   * 触发器最小宽度（px），默认 90。
   *
   * ⚠️ 用**行内样式**而不是 `min-w-[90px]` 工具类：工具类的相互覆盖顺序由
   * Tailwind 自己的排序决定，写在 className 里的 `min-w-0` 并不能可靠地
   * 压过它。行内样式优先级最高，窄容器里传 `0` 就能真正允许收缩到底。
   */
  minWidth?: number;
  /** 触发器自定义内容 */
  children?: ReactNode;
  ariaLabel?: string;
}

/** 触发器默认最小宽度（px）。 */
const DEFAULT_MIN_WIDTH = 90;

/** 选择器。 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  minWidth = DEFAULT_MIN_WIDTH,
  children,
  ariaLabel,
}: SelectProps): JSX.Element {
  const current = options.find((option) => option.value === value);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          style={{ minWidth }}
          className={clsx(
            'inline-flex h-7 items-center justify-between gap-1 rounded px-2 text-xs',
            'bg-[var(--cc-bg-elevated)] text-[var(--cc-fg-primary)] border border-[var(--cc-border)]',
            'hover:border-[var(--cc-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cc-accent)]',
            className,
          )}
        >
          {children ?? <span className="truncate">{current?.label ?? placeholder ?? ''}</span>}
          <span aria-hidden="true" className="shrink-0 text-[10px] text-[var(--cc-fg-muted)]">
            ▾
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          className="z-50 min-w-[140px] overflow-hidden rounded border border-[var(--cc-border)] bg-[var(--cc-bg-panel)] p-1 shadow-xl"
        >
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              disabled={option.disabled}
              onSelect={() => onValueChange(option.value)}
              className={clsx(
                'cursor-pointer rounded px-2 py-1 text-xs outline-none select-none',
                'data-[highlighted]:bg-[var(--cc-bg-elevated)]',
                option.value === value ? 'text-[var(--cc-accent)]' : 'text-[var(--cc-fg-primary)]',
                option.disabled ? 'opacity-40' : '',
              )}
            >
              {option.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
