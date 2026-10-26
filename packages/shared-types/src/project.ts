/**
 * 工程模型 —— QD视界 的数据契约（唯一真源）。
 *
 * 约定：
 * 1. 时间单位统一为**毫秒整数**。
 * 2. 含可扩展结构的接口都带 `[extra: string]: unknown` 索引签名，
 *    反序列化时**保留未知字段并原样写回**（forward-compatible）。
 * 3. 字段命名一律 `camelCase`；时间后缀 `Ms`，字节 `sizeBytes`，角度 `rotation`（度）。
 */

import type { AICapability } from './ai-capabilities.js';

// ============ 基础枚举 ============

export type TrackType = 'video' | 'audio' | 'text' | 'subtitle';
export type AssetType = 'video' | 'audio' | 'image';
export type AssetSourceType = 'local' | 'builtin' | 'connector';
export type AspectPreset = '16:9' | '9:16' | '1:1' | '4:5' | 'custom';
export type FitMode = 'contain' | 'cover' | 'fill';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type ExportFormat = 'mp4' | 'webm';

// ============ 变换 ============

export interface ClipTransform {
  /** 画布宽的 0~1 比例 */
  x: number;
  /** 画布高的 0~1 比例 */
  y: number;
  /** > 0 */
  scale: number;
  /** 度 */
  rotation: number;
  /** 0~1 */
  opacity: number;
  fit: FitMode;
  /** px（仅 isOverlay 生效） */
  cornerRadius: number;
  [extra: string]: unknown;
}

// ============ 音频属性 ============

/** 音量包络关键帧（相对 clip 起点的毫秒 + 增益）。 */
export interface AudioEnvelopePoint {
  /** 相对 clip 起点，0 ~ durationMs */
  timeMs: number;
  /** 0~2 */
  gain: number;
}

export interface ClipAudioProps {
  muted: boolean;
  /** 0~2，步进 0.01 */
  gain: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** 音频是否已从「音画同轨」的视频 clip 中拆出（避免重复提取 / 重复发声）。 */
  extracted?: boolean;
  /** 音量包络（关键帧）。为空表示全程恒定 `gain`。 */
  envelope?: AudioEnvelopePoint[];
  [extra: string]: unknown;
}

// ============ 文字属性 ============

export interface ClipTextProps {
  /** 支持 \n 多行 */
  content: string;
  fontFamily: string;
  /** 基于 1080p 画布参考像素 */
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  color: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string | null;
  lineHeight: number;
  letterSpacing: number;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  [extra: string]: unknown;
}

// ============ 滤镜 ============

/** 滤镜预设 id。 */
export type FilterPresetId =
  | 'none'
  | 'vivid'
  | 'mono'
  | 'vintage'
  | 'cool'
  | 'warm'
  | 'fade'
  | 'sharp';

/**
 * clip 滤镜（Canvas 2D `ctx.filter`，预览与导出共用同一实现）。
 *
 * `intensity` 为 0~1 的强度系数，由预设映射函数插值到具体滤镜参数。
 */
export interface ClipFilter {
  /** 预设 id，`none` 表示无滤镜 */
  preset: FilterPresetId;
  /** 强度 0~1 */
  intensity: number;
  [extra: string]: unknown;
}

// ============ Clip ============

export interface Clip {
  id: string;
  /** 文字 clip 为 null */
  assetId: string | null;
  /** 时间线起点 */
  startMs: number;
  /** 时间线时长（已含变速） */
  durationMs: number;
  /** 源素材入点 */
  inMs: number;
  /** 源素材出点 */
  outMs: number;
  /** 0.1 ~ 10 */
  speed: number;
  /** 画中画 */
  isOverlay: boolean;
  /** isOverlay 时的叠放次序 */
  zIndex: number;
  transform: ClipTransform;
  audio: ClipAudioProps;
  text?: ClipTextProps;
  label: string | null;
  /** 滤镜（缺省视为无滤镜） */
  filter?: ClipFilter;
  [extra: string]: unknown;
}

// ============ Track ============

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  /** 渲染层级，数值大者在上层 */
  order: number;
  muted: boolean;
  /** 仅视频轨 */
  hidden: boolean;
  locked: boolean;
  height: number;
  clips: Clip[];
  [extra: string]: unknown;
}

// ============ Asset ============

export interface AssetLicense {
  /** 'pixabay' | 'freesound' | ... */
  source: string;
  /** 'CC0' */
  name: string;
  author: string | null;
  url: string | null;
  [extra: string]: unknown;
}

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  sourceType: AssetSourceType;
  mimeType: string;
  sizeBytes: number;
  /** IndexedDB Blob 主键 */
  blobKey: string | null;
  /** FR-061 代理文件 */
  proxyBlobKey: string | null;
  thumbnailBlobKey: string | null;
  /** 音频：0~1 归一化，约 400 点 */
  waveform: number[] | null;
  durationMs: number;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  /** false = 浏览器无法解码（如部分 .mov） */
  playable: boolean;
  license: AssetLicense | null;
  /** ISO 8601 */
  importedAt: string;
  [extra: string]: unknown;
}

// ============ 字幕 ============

export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  [extra: string]: unknown;
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  align: TextAlign;
  bottomOffsetPx: number;
  [extra: string]: unknown;
}

export interface SubtitleDoc {
  enabled: boolean;
  style: SubtitleStyle;
  cues: SubtitleCue[];
  [extra: string]: unknown;
}

// ============ 设置 ============

export interface CanvasSettings {
  width: number;
  height: number;
  fps: number;
  aspectPreset: AspectPreset;
  backgroundColor: string;
  [extra: string]: unknown;
}

export interface ExportSettings {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  /** bps */
  videoBitrate: number;
  /** bps */
  audioBitrate: number;
  burnInSubtitle: boolean;
  [extra: string]: unknown;
}

export interface ProviderConfig {
  type: 'local' | 'cloud' | 'webgpu';
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  [extra: string]: unknown;
}

export interface ProjectSettings {
  canvas: CanvasSettings;
  export: ExportSettings;
  ai: {
    /** capability -> providerId */
    routes: Partial<Record<AICapability, string | null>>;
    /** providerId -> 配置 */
    providers: Record<string, ProviderConfig>;
    [extra: string]: unknown;
  };
  [extra: string]: unknown;
}

// ============ 工程 ============

export interface ProjectMeta {
  /** 派生值 */
  durationMs: number;
  lastExport: {
    at: string;
    format: ExportFormat;
    width: number;
    height: number;
    fps: number;
    sizeBytes: number;
    blobKey: string;
  } | null;
  [extra: string]: unknown;
}

export interface ProjectDoc {
  /** "1.0.0" */
  schemaVersion: string;
  /** uuid v4 */
  projectId: string;
  name: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  generator: { app: string; version: string };
  settings: ProjectSettings;
  assets: Record<string, Asset>;
  tracks: Track[];
  subtitles: SubtitleDoc;
  meta: ProjectMeta;
  /** 未知字段原样写回 */
  [extra: string]: unknown;
}

// ============ 派生量 / 工厂用的默认常量 ============

/** 当前工程 schema 版本。 */
export const CURRENT_SCHEMA_VERSION = '1.0.0';

/** 应用标识，写入 `generator`。 */
export const APP_ID = 'clipcut-web';

/** 默认画布（1920×1080 @30fps）。 */
export const DEFAULT_CANVAS: CanvasSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  aspectPreset: '16:9',
  backgroundColor: '#000000',
};

/** 默认导出设置。 */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  burnInSubtitle: false,
};

/** 默认 transform。 */
export const DEFAULT_TRANSFORM: ClipTransform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  opacity: 1,
  // 默认「填满画布」（cover）：与剪映 / CapCut 一致 —— 视频铺满画布，
  // 切换画布比例时画面随之重新构图，预览所见即所选比例。过去的 contain
  // 会按素材自身宽高比 letterbox，比例一不一致就出现黑边，用户感知为
  // 「预览显示的不是我选的比例」。
  fit: 'cover',
  cornerRadius: 0,
};

/** 默认音频属性。 */
export const DEFAULT_AUDIO_PROPS: ClipAudioProps = {
  muted: false,
  gain: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
};

/** 默认字幕样式。 */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Noto Sans SC',
  fontSize: 48,
  color: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 3,
  align: 'center',
  bottomOffsetPx: 80,
};
