/**
 * 媒体服务常量。
 */

/** 波形默认采样点数（FR-009②）。 */
export const DEFAULT_WAVEFORM_POINTS = 400;

/** 缩略图默认取帧位置（毫秒）—— 第 1s 帧。 */
export const THUMBNAIL_AT_MS = 1000;

/** 音画同步容差（毫秒）。 */
export const AV_SYNC_TOLERANCE_MS = 40;

/** 视频池允许的最大漂移（毫秒），超过才 seek。 */
export const VIDEO_DRIFT_THRESHOLD_MS = 40;
