/**
 * 文本输入（支持多行模式）。
 */

import type { KeyboardEvent } from 'react';
import { clsx } from '../../utils/clsx.js';

/** TextField 属性。 */
export interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** 回车回调。 */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/** 文本输入。 */
export function TextField({
  value,
  onValueChange,
  placeholder,
  label,
  multiline = false,
  rows = 4,
  className,
  disabled = false,
  autoFocus = false,
  onKeyDown,
}: TextFieldProps): JSX.Element {
  return (
    <label className={clsx('flex flex-col gap-1', className)}>
      {label ? <span className="cc-label">{label}</span> : null}
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => onValueChange(event.target.value)}
          {...(onKeyDown ? { onKeyDown } : {})}
          className="cc-input resize-y leading-relaxed"
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => onValueChange(event.target.value)}
          {...(onKeyDown ? { onKeyDown } : {})}
          className="cc-input"
        />
      )}
    </label>
  );
}
