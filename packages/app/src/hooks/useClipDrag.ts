/**
 * clip 拖拽（性能核心，ARCHITECTURE §8.3）。
 *
 * 四层优化：
 * ① 拖拽期间**不写 React state**，指针移动只改被拖 clip 的 `style.transform`；
 * ② 吸附参考线是独立 overlay 层；
 * ③ 虚拟化只挂载视口内 clip（拖拽中的 clip 强制保持挂载）；
 * ④ 波形/缩略图缓存。
 *
 * **提交时机**：指针抬起时**一次性**调用 `moveClip` → 只产生 1 条历史记录。
 */

import { useCallback, useRef } from 'react';
import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';
import { collectSnapCandidates, findSnap } from '../domain/timeline/snapping.js';
import { capturePointer, releasePointer } from '../utils/dom.js';
import { moveClip } from '../state/actions.js';
import { useProjectStore } from '../state/projectStore.js';
import { useUiStore } from '../state/uiStore.js';
import { usePlaybackStore } from '../state/playbackStore.js';

/** 拖拽参数。 */
export interface ClipDragOptions {
  clip: Clip;
  /** 所属轨道 id（提交移动时使用）。 */
  trackId: string;
  /** 所属轨道是否锁定。 */
  locked?: boolean;
}

/** 拖拽句柄。 */
export interface ClipDragHandle {
  /** 开始拖拽（绑定到 pointerdown）。 */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** 是否正在拖拽。 */
  readonly dragging: boolean;
}

/**
 * 拖拽交互 Hook。
 */
export function useClipDrag(options: ClipDragOptions): ClipDragHandle {
  const { clip, trackId, locked = false } = options;
  const draggingRef = useRef(false);
  const elementRef = useRef<HTMLElement | null>(null);
  const originRef = useRef({ startMs: clip.startMs, pointerX: 0, pointerId: -1 });

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => {
      if (locked) return;
      if (event.button !== 0) return;

      const element = event.currentTarget;
      elementRef.current = element;
      originRef.current = { startMs: clip.startMs, pointerX: event.clientX, pointerId: event.pointerId };
      draggingRef.current = true;

      capturePointer(element, event.pointerId);

      const ui = useUiStore.getState();
      ui.setDragSession({
        kind: 'move',
        clipId: clip.id,
        originStartMs: clip.startMs,
        originInMs: clip.inMs,
        originOutMs: clip.outMs,
        snapMs: null,
        snapKind: null,
        targetTrackId: trackId,
      });

      const onMove = (moveEvent: PointerEvent): void => {
        if (!draggingRef.current) return;
        const deltaMs = ((moveEvent.clientX - originRef.current.pointerX) / ui.pxPerSecond) * 1000;
        const rawStart = Math.max(0, Math.round(originRef.current.startMs + deltaMs));

        // 吸附计算
        let finalStart = rawStart;
        let snapMs: number | null = null;
        let snapKind: 'playhead' | 'clip-start' | 'clip-end' | 'second' | null = null;

        if (ui.snapEnabled) {
          const doc = useProjectStore.getState().doc;
          const playheadMs = usePlaybackStore.getState().currentTimeMs;
          const candidates = collectSnapCandidates(doc, [clip.id], playheadMs);
          const startSnap = findSnap(rawStart, candidates, ui.pxPerSecond, ui.snapThresholdPx);
          const endSnap = findSnap(
            rawStart + clip.durationMs,
            candidates,
            ui.pxPerSecond,
            ui.snapThresholdPx,
          );

          if (startSnap) {
            finalStart = startSnap.ms;
            snapMs = startSnap.ms;
            snapKind = startSnap.candidate.kind;
          } else if (endSnap) {
            finalStart = endSnap.ms - clip.durationMs;
            snapMs = endSnap.ms;
            snapKind = endSnap.candidate.kind;
          }
        }

        // 只改 DOM style，不触发 React 重渲染
        const offsetPx = (finalStart - originRef.current.startMs) * (ui.pxPerSecond / 1000);
        element.style.transform = `translateX(${offsetPx}px)`;

        // 跨轨命中：按指针 Y 坐标找到目标轨道（类型不兼容则回到原轨）
        let resolvedTarget = trackId;
        const hit = hitTestTrack(moveEvent.clientX, moveEvent.clientY);
        if (hit && hit !== trackId) {
          const doc = useProjectStore.getState().doc;
          const targetTrack = doc.tracks.find((t) => t.id === hit);
          if (targetTrack && canDropOnTrack(doc, clip, targetTrack)) {
            resolvedTarget = hit;
          }
        }

        useUiStore.getState().setDragSession({
          ...(useUiStore.getState().dragSession ?? {
            kind: 'move' as const,
            clipId: clip.id,
            originStartMs: clip.startMs,
            originInMs: clip.inMs,
            originOutMs: clip.outMs,
            snapMs: null,
            snapKind: null,
            targetTrackId: trackId,
          }),
          snapMs,
          snapKind,
          targetTrackId: resolvedTarget,
        });
      };

      const onUp = (upEvent: PointerEvent): void => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        releasePointer(element, upEvent.pointerId);

        const finalStart = Math.round(
          parseFloat(element.style.transform.replace('translateX(', '').replace('px)', '') || '0') /
            (ui.pxPerSecond / 1000) +
            originRef.current.startMs,
        );

        element.style.transform = '';

        // 一次性提交 → 1 条历史记录（支持跨轨：以拖拽期间命中的目标轨为准）
        const committedTarget =
          useUiStore.getState().dragSession?.targetTrackId ?? trackId;
        useUiStore.getState().setDragSession(null);

        if (finalStart !== originRef.current.startMs || committedTarget !== trackId) {
          moveClip(clip.id, committedTarget, finalStart);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
      window.addEventListener('pointercancel', onUp, { once: true });
    },
    [clip, trackId, locked],
  );

  return {
    onPointerDown,
    get dragging(): boolean {
      return draggingRef.current;
    },
  };
}

/**
 * 判断两个轨道之间是否允许拖拽（跨类型禁止）。
 */
export function canDropOnTrack(doc: ProjectDoc, clip: Clip, targetTrack: Track): boolean {
  const asset = clip.assetId ? doc.assets[clip.assetId] : undefined;
  const assetType = asset?.type ?? 'image';

  if (targetTrack.type === 'audio') return assetType === 'audio';
  if (targetTrack.type === 'video') return assetType === 'video' || assetType === 'image';
  return assetType === 'video' || assetType === 'image';
}

// ============ 轨道 DOM 注册表（跨轨拖拽命中目标轨道用） ============

/**
 * 轨道元素注册表：拖拽时按指针视口坐标命中目标轨道。
 *
 * 由 `TrackRow` 在挂载时登记自身 DOM、卸载时注销；`useClipDrag` 在
 * `pointermove` 期间用 `getBoundingClientRect` 实时命中（已含滚动偏移）。
 */
const trackElements = new Map<string, HTMLElement>();

/** 登记轨道元素。 */
export function registerTrackElement(trackId: string, element: HTMLElement): void {
  trackElements.set(trackId, element);
}

/** 注销轨道元素。 */
export function unregisterTrackElement(trackId: string): void {
  trackElements.delete(trackId);
}

/** 按视口坐标命中轨道（返回 trackId 或 null）。 */
export function hitTestTrack(clientX: number, clientY: number): string | null {
  for (const [trackId, element] of trackElements) {
    const rect = element.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return trackId;
    }
  }
  return null;
}
