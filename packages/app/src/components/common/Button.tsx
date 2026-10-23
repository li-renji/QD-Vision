/**
 * 通用按钮。
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clsx } from '../../utils/clsx.js';

/** 按钮变体。 */
export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

/** 按钮尺寸。 */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** 按钮属性。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--cc-accent)] text-white hover:bg-[var(--cc-accent-hover)]',
  ghost: 'bg-transparent text-[var(--cc-fg-secondary)] hover:bg-[var(--cc-bg-elevated)] hover:text-[var(--cc-fg-primary)]',
  danger: 'bg-[var(--cc-danger)] text-white hover:opacity-90',
  subtle: 'bg-[var(--cc-bg-elevated)] text-[var(--cc-fg-primary)] hover:bg-[var(--cc-bg-track)]',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-[11px]',
  md: 'h-7 px-3 text-xs',
  lg: 'h-9 px-4 text-sm',
};

/** 按钮。 */
export function Button({
  variant = 'subtle',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cc-accent)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {loading ? <span className="cc-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
