/**
 * Radix Tooltip 封装。
 */

import type { ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

/** Tooltip 宿主（放在应用根部一次）。 */
export function TooltipProvider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/** Tooltip 属性。 */
export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** Tooltip。 */
export function Tooltip({ content, children, side = 'top' }: TooltipProps): JSX.Element {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded bg-[var(--cc-bg-elevated)] px-2 py-1 text-[11px] text-[var(--cc-fg-primary)] shadow-lg"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
