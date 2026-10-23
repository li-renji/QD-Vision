/**
 * 全局轻提示（导入结果、格式不支持、撤销提示）。
 *
 * 自研轻量实现：全局订阅 + 固定定位堆叠，无第三方依赖。
 */

import { useEffect, useState } from 'react';
import { clsx } from '../../utils/clsx.js';

/** 提示类型。 */
export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

/** 提示项。 */
export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  durationMs: number;
}

/** 提示订阅者。 */
const listeners = new Set<(items: ToastItem[]) => void>();

/** 当前提示列表。 */
let items: ToastItem[] = [];

/** 自增 id。 */
let nextId = 1;

/** 通知订阅者。 */
function notify(): void {
  for (const listener of listeners) listener([...items]);
}

/**
 * 显示一条提示。
 */
export function toast(message: string, variant: ToastVariant = 'info', durationMs = 3200): number {
  const id = nextId;
  nextId += 1;
  items = [...items, { id, message, variant, durationMs }];
  notify();

  window.setTimeout(() => {
    dismissToast(id);
  }, durationMs);

  return id;
}

/**
 * 关闭一条提示。
 */
export function dismissToast(id: number): void {
  items = items.filter((item) => item.id !== id);
  notify();
}

/** 清空全部提示。 */
export function clearToasts(): void {
  items = [];
  notify();
}

/** 提示宿主。 */
export function ToastHost(): JSX.Element {
  const [list, setList] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  if (list.length === 0) return <></>;

  return (
    <div className="pointer-events-none fixed bottom-8 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {list.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => dismissToast(item.id)}
          className={clsx(
            'pointer-events-auto max-w-md rounded-md border px-3 py-2 text-xs shadow-xl',
            item.variant === 'success' && 'border-[var(--cc-success)] bg-[var(--cc-bg-elevated)] text-[var(--cc-success)]',
            item.variant === 'error' && 'border-[var(--cc-danger)] bg-[var(--cc-bg-elevated)] text-[var(--cc-danger)]',
            item.variant === 'warning' && 'border-[var(--cc-warning)] bg-[var(--cc-bg-elevated)] text-[var(--cc-warning)]',
            item.variant === 'info' && 'border-[var(--cc-border-strong)] bg-[var(--cc-bg-elevated)] text-[var(--cc-fg-primary)]',
          )}
        >
          {item.message}
        </button>
      ))}
    </div>
  );
}
