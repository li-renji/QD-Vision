/**
 * 测试环境准备。
 *
 * - 注入 `fake-indexeddb`（存储层测试需要）。
 * - happy-dom 不实现 `ResizeObserver` / `IntersectionObserver`，补上最小桩。
 */

import 'fake-indexeddb/auto';

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {
      /* no-op */
    }

    unobserve(): void {
      /* no-op */
    }

    disconnect(): void {
      /* no-op */
    }
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];

    observe(): void {
      /* no-op */
    }

    unobserve(): void {
      /* no-op */
    }

    disconnect(): void {
      /* no-op */
    }

    takeRecords(): [] {
      return [];
    }
  }
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver;
}
