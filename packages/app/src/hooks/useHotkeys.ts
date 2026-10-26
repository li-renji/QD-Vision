/**
 * 全局快捷键绑定。
 *
 * 支持：空格（播放/暂停）、`,` / `.`（逐帧）、`J` / `K` / `L`（快退/暂停/快进）、
 * `S`（分割）、`Delete`（删除）、`Ctrl+Z` / `Ctrl+Shift+Z`（撤销/重做）、
 * `Ctrl+C` / `Ctrl+V`（复制/粘贴）、`Ctrl+A`（全选）、`Home` / `End`。
 *
 * **输入框聚焦时自动禁用**（FR-025①）。
 */

import { useEffect } from 'react';
import { isEditableTarget } from '../utils/dom.js';
import { usePlaybackStore } from '../state/playbackStore.js';

/** 快捷键回调集合。 */
export interface HotkeyHandlers {
  onTogglePlay?: () => void;
  onStepFrame?: (direction: 1 | -1) => void;
  onShuttle?: (direction: 'back' | 'stop' | 'forward') => void;
  onSplit?: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onSelectAll?: () => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
}

/**
 * 倍速档位（**仅正值**，0.25× ~ 100×）。
 *
 * 不提供负倍速：倒放是独立能力（走单独的倒放控制），不该混进「倍速」里——
 * 负倍速对用户是不可理解的脏值。真正需要倒放时用专用入口，而非这里。
 */
const SHUTTLE_RATES = [0.25, 0.5, 1, 2, 4, 8, 16, 50, 100];

/**
 * 注册全局快捷键。
 *
 * @param handlers 回调集合，或返回回调集合的工厂函数（避免每次渲染重建订阅）
 */
export function useHotkeys(
  handlers: HotkeyHandlers | (() => HotkeyHandlers),
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const resolve = (): HotkeyHandlers =>
      typeof handlers === 'function' ? handlers() : handlers;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      const h = resolve();

      const ctrl = event.ctrlKey || event.metaKey;

      if (ctrl) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) h.onRedo?.();
            else h.onUndo?.();
            return;
          case 'y':
            event.preventDefault();
            h.onRedo?.();
            return;
          case 'c':
            event.preventDefault();
            h.onCopy?.();
            return;
          case 'v':
            event.preventDefault();
            h.onPaste?.();
            return;
          case 'a':
            event.preventDefault();
            h.onSelectAll?.();
            return;
          default:
            return;
        }
      }

      switch (event.key) {
        case ' ':
          event.preventDefault();
          h.onTogglePlay?.();
          return;
        case ',':
          event.preventDefault();
          h.onStepFrame?.(-1);
          return;
        case '.':
          event.preventDefault();
          h.onStepFrame?.(1);
          return;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          h.onDelete?.();
          return;
        case 'Home':
          event.preventDefault();
          h.onSeekStart?.();
          return;
        case 'End':
          event.preventDefault();
          h.onSeekEnd?.();
          return;
        default:
          break;
      }

      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        h.onSplit?.();
        return;
      }
      if (key === 'j' || key === 'k' || key === 'l') {
        event.preventDefault();
        if (key === 'j') h.onShuttle?.('back');
        else if (key === 'k') h.onShuttle?.('stop');
        else h.onShuttle?.('forward');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, handlers]);
}

/**
 * J/K/L 倍速切换。
 */
export function useShuttle(): number {
  return usePlaybackStore((state) => state.playbackRate);
}

/** 导出倍速档位，供 UI 展示。 */
export { SHUTTLE_RATES };
