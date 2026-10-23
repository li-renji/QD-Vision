/**
 * DOM 工具：测量、指针捕获、被动事件监听。
 *
 * 仅供表现层（components / hooks）使用，领域层与服务层禁止依赖本文件。
 */

/** 测量元素尺寸。 */
export function measureElement(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

/**
 * 指针捕获。
 *
 * 拖拽交互统一走这里，保证 `pointerup` 一定能收到（即使指针移出元素）。
 */
export function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // 某些浏览器在指针已释放时会抛错，忽略即可。
  }
}

/** 释放指针捕获。 */
export function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // 同上
  }
}

/** 添加被动事件监听（滚动/触摸性能优化）。 */
export function addPassiveListener<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  const handler = listener as EventListener;
  target.addEventListener(type, handler, { passive: true, ...options });
  return () => {
    target.removeEventListener(type, handler, options);
  };
}

/** 判断事件目标是否是可编辑元素（输入框聚焦时禁用快捷键）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/** 读取 CSS 变量。 */
export function readCssVariable(name: string, element?: HTMLElement): string {
  const target = element ?? document.documentElement;
  return getComputedStyle(target).getPropertyValue(name).trim();
}
