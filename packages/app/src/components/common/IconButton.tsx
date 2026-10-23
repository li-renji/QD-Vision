/**
 * 图标按钮（Radix Tooltip 集成）。
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { clsx } from '../../utils/clsx.js';

/** 图标按钮属性。 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍标签（同时作为 tooltip 文案） */
  label: string;
  icon: ReactNode;
  /**
   * 按钮尺寸：`xs` = 18px（轨道头等极紧凑场景）、`sm` = 20px、
   * `md` = 28px（工具栏默认）。
   */
  size?: 'xs' | 'sm' | 'md';
  active?: boolean;
}

/** 各尺寸对应的方块边长（px）。 */
const SIZE_CLASS: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'h-[18px] w-[18px]',
  sm: 'h-5 w-5',
  md: 'h-7 w-7',
};

/** 图标按钮。 */
export function IconButton({
  label,
  icon,
  size = 'md',
  active = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <button
          type={type}
          aria-label={label}
          className={clsx(
            'inline-flex items-center justify-center rounded transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cc-accent)]',
            'disabled:cursor-not-allowed disabled:opacity-40',
            SIZE_CLASS[size],
            active
              ? 'bg-[var(--cc-accent)] text-white'
              : 'text-[var(--cc-fg-secondary)] hover:bg-[var(--cc-bg-elevated)] hover:text-[var(--cc-fg-primary)]',
            className,
          )}
          {...rest}
        >
          {icon}
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 rounded bg-[var(--cc-bg-elevated)] px-2 py-1 text-[11px] text-[var(--cc-fg-primary)] shadow-lg"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
