/**
 * 节流与防抖工具。
 *
 * - `debounce`：搜索框 200ms、自动保存 3000ms。
 * - `throttle`：滚动与高频事件。
 */

/** 防抖函数类型。 */
export interface DebouncedFunction<Args extends unknown[]> {
  (...args: Args): void;
  /** 立即取消挂起的调用。 */
  cancel(): void;
  /** 立即执行挂起的调用。 */
  flush(): void;
  /** 当前是否有挂起的调用。 */
  readonly pending: boolean;
}

/**
 * 防抖：等待 `wait` 毫秒内没有新的调用后才执行。
 *
 * @param fn 目标函数
 * @param wait 等待时长（毫秒）
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait = 200,
): DebouncedFunction<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Args | null = null;

  const invoke = (): void => {
    timer = null;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const debounced = ((...args: Args): void => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, wait);
  }) as DebouncedFunction<Args>;

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  debounced.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      invoke();
    }
  };

  Object.defineProperty(debounced, 'pending', {
    get: (): boolean => timer !== null,
  });

  return debounced;
}

/** 节流函数类型。 */
export interface ThrottledFunction<Args extends unknown[]> {
  (...args: Args): void;
  cancel(): void;
}

/**
 * 节流：每 `wait` 毫秒最多执行一次（首次立即执行，尾部补一次）。
 */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait = 100,
): ThrottledFunction<Args> {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const run = (args: Args): void => {
    lastRun = Date.now();
    fn(...args);
  };

  const throttled = ((...args: Args): void => {
    const now = Date.now();
    const elapsed = now - lastRun;
    if (elapsed >= wait) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      run(args);
      return;
    }
    pendingArgs = args;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (pendingArgs) {
          const args2 = pendingArgs;
          pendingArgs = null;
          run(args2);
        }
      }, wait - elapsed);
    }
  }) as ThrottledFunction<Args>;

  throttled.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  return throttled;
}
