/**
 * 测量一个元素的**内容盒**尺寸（不含 padding / border）。
 *
 * ## 为什么需要它
 *
 * 预览画布要「按标准比例铺满窗口」：容器是 `flex` + `overflow-hidden`，
 * 画布需在**不变形**的前提下取「能塞进容器的最大同比例矩形」。
 * 过去用 `max-h-full max-w-full aspect-ratio object-fit` 组合，但：
 * - `object-fit` 对 `<canvas>` **无效**（只对 img/video 等替换元素生效）；
 * - `max-height: 100%` 的百分比要解析到**有确定高度的父元素**，而舞台层
 *   （`w-fit`）高度由内容决定 → 百分比塌缩成 `none`，高度根本不受约束。
 * 两件事叠加，画布在竖版 / 窄容器里会纵向溢出被裁切，比例随之失真。
 *
 * 因此改为**用 JS 量出容器内容区**，再显式算好画布显示宽高 —— 这是
 * 「按标准比例显示」唯一稳妥的做法。
 *
 * 用 `ResizeObserver` 的 `contentRect`（即内容盒，天然排除 padding），
 * 并在挂载时同步测一次，避免首帧 0×0 的闪烁。
 */

import { useLayoutEffect, useRef, useState } from 'react';

/** 元素内容盒尺寸。 */
export interface ElementSize {
  width: number;
  height: number;
}

/**
 * 观测元素内容盒尺寸。
 *
 * @returns `ref` 挂到目标元素上；`size` 为最新内容盒尺寸（未测量前为 0）。
 */
export function useElementSize<T extends HTMLElement>(): {
  ref: React.RefObject<T>;
  size: ElementSize;
} {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = (width: number, height: number): void => {
      setSize((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height },
      );
    };

    // 首帧同步测量：用内容盒 = client 尺寸 - padding，避免 0×0 闪烁。
    const initialSync = (): void => {
      const style = getComputedStyle(element);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      measure(
        Math.max(0, element.clientWidth - (Number.isFinite(padX) ? padX : 0)),
        Math.max(0, element.clientHeight - (Number.isFinite(padY) ? padY : 0)),
      );
    };
    initialSync();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // contentBoxSize 是新 API，contentRect 兼容性更好，二者取其一。
      const box = entry.contentRect;
      measure(box.width, box.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
