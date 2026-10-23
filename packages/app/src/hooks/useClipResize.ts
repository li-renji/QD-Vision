/**
 * clip 边缘拖拽裁剪。
 *
 * - 左边缘改 `inMs`，右边缘改 `outMs`；
 * - 实时显示精确时间码提示；
 * - 越界钳制（`inMs ≥ 0`、`outMs ≤ asset.durationMs`）；最小 100ms；
 * - **抬手时一次性提交** → 1 条历史记录。
 */

import { useCallback, useRef } from 'react';
import type { Asset, Clip } from '@clipcut/shared-types';
import { MIN_CLIP_DURATION_MS } from '../domain/timeline/invariants.js';
import { capturePointer, releasePointer } from '../utils/dom.js';
import { trimClip } from '../state/actions.js';
import { useUiStore } from '../state/uiStore.js';

/** 裁剪参数。 */
export interface ClipResizeOptions {
  clip: Clip;
  asset?: Asset;
  /** 轨道是否锁定 */
  locked?: boolean;
}

/** 裁剪句柄。 */
export interface ClipResizeHandle {
  /** 开始裁剪（绑定到 pointerdown）。 */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}

/**
 * 裁剪交互 Hook。
 */
export function useClipResize(options: ClipResizeOptions): ClipResizeHandle {
  const { clip, asset, locked = false } = options;
  const elementRef = useRef<HTMLElement | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => {
      if (locked) return;
      if (event.button !== 0) return;

      const element = event.currentTarget;
      elementRef.current = element;
      const startX = event.clientX;
      const originIn = clip.inMs;
      const originOut = clip.outMs;
      const assetDuration = asset?.durationMs ?? Number.POSITIVE_INFINITY;

      // 根据把手位置判断是左边缘还是右边缘
      const rect = element.getBoundingClientRect();
      const isLeftEdge = startX - rect.left < rect.width / 2;
      const edge: 'in' | 'out' = isLeftEdge ? 'in' : 'out';

      capturePointer(element, event.pointerId);

      const onMove = (moveEvent: PointerEvent): void => {
        const deltaMs = ((moveEvent.clientX - startX) / useUiStore.getState().pxPerSecond) * 1000;

        let nextIn = originIn;
        let nextOut = originOut;

        if (edge === 'in') {
          nextIn = Math.min(Math.max(0, Math.round(originIn + deltaMs)), originOut - MIN_CLIP_DURATION_MS);
        } else {
          nextOut = Math.max(
            Math.round(originOut + deltaMs),
            originIn + MIN_CLIP_DURATION_MS,
          );
          if (Number.isFinite(assetDuration)) {
            nextOut = Math.min(nextOut, Math.round(assetDuration));
          }
        }

        // 实时预览宽度
        const widthPx = ((nextOut - nextIn) / clip.speed / 1000) * useUiStore.getState().pxPerSecond;
        element.style.width = `${Math.max(2, widthPx)}px`;

        useUiStore.getState().setDragSession({
          kind: 'resize',
          clipId: clip.id,
          originStartMs: clip.startMs,
          originInMs: originIn,
          originOutMs: originOut,
          snapMs: edge === 'in' ? nextIn : nextOut,
          snapKind: null,
          targetTrackId: null,
        });
      };

      const onUp = (upEvent: PointerEvent): void => {
        releasePointer(element, upEvent.pointerId);
        element.style.width = '';

        const session = useUiStore.getState().dragSession;
        useUiStore.getState().setDragSession(null);

        const nextValue = session?.snapMs ?? (edge === 'in' ? originIn : originOut);
        const changed = edge === 'in' ? nextValue !== originIn : nextValue !== originOut;

        if (changed) {
          trimClip(clip.id, edge, nextValue);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
      window.addEventListener('pointercancel', onUp, { once: true });
    },
    [clip, asset, locked],
  );

  return { onPointerDown };
}
