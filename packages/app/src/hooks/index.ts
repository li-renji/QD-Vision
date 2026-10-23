/**
 * Hooks 出口。
 */

export { useRenderLoop, type RenderLoopOptions } from './useRenderLoop.js';
export { SHUTTLE_RATES, useHotkeys, useShuttle, type HotkeyHandlers } from './useHotkeys.js';
export { useFileDrop, type FileDropOptions, type FileDropState } from './useFileDrop.js';
export {
  OVERSCAN_SCREENS,
  useVirtualizedRows,
  type VirtualizedRowsOptions,
  type VirtualizedRowsResult,
} from './useVirtualizedRows.js';
export { canDropOnTrack, useClipDrag, type ClipDragHandle, type ClipDragOptions } from './useClipDrag.js';
export { useClipResize, type ClipResizeHandle, type ClipResizeOptions } from './useClipResize.js';
