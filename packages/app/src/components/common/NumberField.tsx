/**
 * 数值输入（带单位、步进、范围钳制）。
 */

import { useEffect, useState } from 'react';
import { clsx } from '../../utils/clsx.js';

/** NumberField 属性。 */
export interface NumberFieldProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

/** 数值输入。 */
export function NumberField({
  value,
  onValueChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  unit,
  label,
  className,
  disabled = false,
}: NumberFieldProps): JSX.Element {
  const [draft, setDraft] = useState<string>(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string): void => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onValueChange(clamped);
    setDraft(String(clamped));
  };

  return (
    <label className={clsx('flex items-center gap-1', className)}>
      {label ? <span className="cc-label w-16 shrink-0">{label}</span> : null}
      <input
        type="number"
        value={draft}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit((event.target as HTMLInputElement).value);
        }}
        className="cc-input w-20 tabular-nums"
      />
      {unit ? <span className="cc-label">{unit}</span> : null}
    </label>
  );
}
