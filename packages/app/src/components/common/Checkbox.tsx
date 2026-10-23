/**
 * 勾选框。
 */

import { clsx } from '../../utils/clsx.js';

/** Checkbox 属性。 */
export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/** 勾选框。 */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
}: CheckboxProps): JSX.Element {
  return (
    <label className={clsx('inline-flex items-center gap-1.5 select-none', className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--cc-accent)]"
      />
      {label ? <span className="text-xs text-[var(--cc-fg-secondary)]">{label}</span> : null}
    </label>
  );
}
