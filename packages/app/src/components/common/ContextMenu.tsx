/**
 * Radix ContextMenu 封装（时间线右键菜单底座）。
 *
 * 用法：
 * ```tsx
 * <ContextMenu content={<MenuItems />}>
 *   <div className="...">右键目标</div>
 * </ContextMenu>
 * ```
 * `children` 作为 Trigger，`content` 作为菜单内容（Radix 自动处理定位）。
 */

import type { ReactNode } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { clsx } from '../../utils/clsx.js';

/** 菜单项属性。 */
export interface ContextMenuItemProps {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
}

/** 菜单项。 */
export function ContextMenuItem({
  label,
  onSelect,
  disabled = false,
  shortcut,
}: ContextMenuItemProps): JSX.Element {
  return (
    <ContextMenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={clsx(
        'cursor-pointer rounded px-2 py-1 text-xs outline-none select-none',
        'data-[highlighted]:bg-[var(--cc-bg-elevated)]',
        'data-[disabled]:opacity-40',
        'flex items-center justify-between gap-4',
      )}
    >
      <span>{label}</span>
      {shortcut ? (
        <span className="text-[10px] text-[var(--cc-fg-muted)]">{shortcut}</span>
      ) : null}
    </ContextMenuPrimitive.Item>
  );
}

/** 分隔线。 */
export function ContextMenuSeparator(): JSX.Element {
  return <ContextMenuPrimitive.Separator className="my-1 h-px bg-[var(--cc-border)]" />;
}

/** 菜单分组标签。 */
export function ContextMenuLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ContextMenuPrimitive.Label className="px-2 py-1 text-[10px] uppercase text-[var(--cc-fg-muted)]">
      {children}
    </ContextMenuPrimitive.Label>
  );
}

/** 菜单容器。 */
export function ContextMenu({
  children,
  content,
}: {
  children: ReactNode;
  content: ReactNode;
}): JSX.Element {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="z-50 min-w-[180px] rounded border border-[var(--cc-border)] bg-[var(--cc-bg-panel)] p-1 shadow-xl">
          {content}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
