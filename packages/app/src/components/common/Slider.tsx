/**
 * Radix Slider 封装（音量 / 不透明度 / 缩放）。
 */

import * as SliderPrimitive from '@radix-ui/react-slider';
import { clsx } from '../../utils/clsx.js';

/** Slider 属性。 */
export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

/** 滑块。 */
export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.01,
  className,
  ariaLabel,
  disabled = false,
}: SliderProps): JSX.Element {
  return (
    <SliderPrimitive.Root
      value={[value]}
      onValueChange={(values) => {
        const next = values[0];
        if (next !== undefined) onValueChange(next);
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      className={clsx('relative flex h-4 w-full items-center select-none', className)}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-[var(--cc-bg-track)]">
        <SliderPrimitive.Range className="absolute h-full bg-[var(--cc-accent)]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={clsx(
          'block h-3 w-3 rounded-full bg-[var(--cc-fg-primary)] shadow',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cc-accent)]',
        )}
      />
    </SliderPrimitive.Root>
  );
}
