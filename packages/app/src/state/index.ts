/**
 * 状态层出口。
 */

export {
  useProjectStore,
  getProjectDoc,
  type ProjectState,
} from './projectStore.js';
export {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  useHistoryStore,
  type HistoryEntry,
  type HistoryState,
} from './historyStore.js';
export {
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  useUiStore,
  type DragSession,
  type MediaFilter,
  type PanelWidths,
  type UiState,
} from './uiStore.js';
export {
  getCurrentTimeMs,
  getPlaybackClock,
  isPlaying,
  resolveTimelineDuration,
  usePlaybackStore,
  type PlaybackState,
} from './playbackStore.js';
export {
  MAX_CLOCK_DELTA_MS,
  createPlaybackClock,
  type PlaybackClock,
  type PlaybackClockOptions,
} from './playbackClock.js';
export {
  getStoreMiddleware,
  installStoreMiddleware,
  type StoreMiddlewareHandle,
  type StoreMiddlewareOptions,
} from './storeMiddleware.js';
export {
  addAsset,
  addClip,
  addSubtitleCue,
  addTextClip,
  addTrack,
  clipboard,
  copySelectedClips,
  deleteClip,
  deleteSelectedClips,
  duplicateClip,
  exportProjectFile,
  extractAudio,
  importSubtitleCues,
  moveClip,
  pasteClips,
  redo,
  removeAsset,
  removeSubtitleCue,
  removeTrack,
  renameTrack,
  resetHistory,
  resizeCanvas,
  saveProjectNow,
  setAiSettings,
  setCanvasSettings,
  setClipProperty,
  setClipPropertyForSelected,
  setClipSpeed,
  setExportSettings,
  setSubtitleSettings,
  setTextProps,
  setTrackFlags,
  splitClip,
  splitSelectedClip,
  trimClip,
  undo,
  updateAsset,
  updateSubtitleCue,
  type ActionResult,
  type ClipSnapshot,
} from './actions.js';
export {
  useActiveOverlayClips,
  useAssetList,
  useAssets,
  useCanvasSettings,
  useClipAtTime,
  useExportSettings,
  useOrderedTracks,
  usePrimarySelectedClip,
  useProjectDoc,
  useProjectDuration,
  useSelectedClipIds,
  useSelectedClips,
  useSubtitles,
  useVisibleVideoTracks,
} from './selectors.js';
