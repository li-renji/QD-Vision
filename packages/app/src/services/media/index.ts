/**
 * 媒体服务出口。
 */

export {
  AV_SYNC_TOLERANCE_MS,
  DEFAULT_WAVEFORM_POINTS,
  THUMBNAIL_AT_MS,
  VIDEO_DRIFT_THRESHOLD_MS,
} from './constants.js';
export { importFile, importFiles, type ImportResult } from './assetService.js';
export {
  probeAudio,
  probeImage,
  probeMedia,
  probeVideo,
  type MediaMetadata,
} from './metadataProbe.js';
export { captureFrameBlob, generateThumbnail } from './thumbnailService.js';
export { computeWaveform } from './waveformService.js';
export {
  createFrameProvider,
  disposeAllFrameProviders,
  registerFrameSource,
  type FrameProviderFactoryOptions,
} from './frameProviders/index.js';
export type { FrameProvider } from './frameProviders/types.js';
export {
  ElementFrameProvider,
} from './frameProviders/elementProvider.js';
export {
  MAX_GOP_CACHE_FRAMES,
  Mp4DecoderFrameProvider,
} from './frameProviders/mp4DecoderProvider.js';
export {
  PITCH_PRESERVE_WORKLET_NAME,
  applyFadeEnvelope,
  buildAudioGraph,
  mixDurationMs,
  mixableTracks,
  type AudioGraph,
  type AudioGraphOptions,
} from './audioGraph.js';
export { AudioEngine, audioEngine } from './audioEngine.js';
export { createVideoPool, type VideoPool, type VideoPoolElement } from './videoPool.js';
