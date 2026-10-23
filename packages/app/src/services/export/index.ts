/**
 * 导出服务出口。
 */

export {
  probeCodecMatrix,
  type AudioCodecKey,
  type CodecMatrix,
  type VideoCodecKey,
} from './capabilityProbe.js';
export {
  ExportController,
  exportController,
  readExportArtifact,
  type ExportJob,
  type ExportJobStatus,
  type ExportRequest,
} from './exportController.js';
export {
  AUDIO_CHUNK_SAMPLES,
  KEYFRAME_INTERVAL_MS,
  exportWithWebCodecs,
  type ExportProgress,
  type WebCodecsExportOptions,
} from './webCodecsExporter.js';
export {
  DEFAULT_OFFLINE_CHANNEL_COUNT,
  DEFAULT_OFFLINE_SAMPLE_RATE,
  MAX_MASTER_GAIN,
  collectMixableAssetIds,
  hasAudibleAudio,
  peakAmplitude,
  renderOfflineMix,
  resolveClipScheduling,
  resolveExportMasterGain,
  type ClipScheduling,
  type OfflineMixOptions,
  type OfflineMixResult,
  type OfflineRenderContext,
} from './offlineAudioRenderer.js';
export {
  exportWithMediaRecorder,
  type MediaRecorderExportOptions,
  type MediaRecorderExportResult,
} from './mediaRecorderExporter.js';
export {
  encodeWav,
  exportAudio,
  type AudioExportFormat,
  type AudioExportResult,
} from './audioExporter.js';
export { createDownloadUrl, downloadBlob } from './download.js';
