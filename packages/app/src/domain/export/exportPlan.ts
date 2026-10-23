/**
 * 导出计划（领域层纯函数）。
 *
 * 职责：
 * - 计算总帧数、目标编码参数与预计体积；
 * - 检测非法组合（4K@60 等）并给出**自动降级建议**（FR-038①）。
 */

import type { ExportFormat, ProjectDoc } from '@clipcut/shared-types';

/** 分辨率预设。 */
export const RESOLUTION_PRESETS = {
  canvas: { label: '跟随画布', width: 0, height: 0 },
  '720p': { label: '720p', width: 1280, height: 720 },
  '1080p': { label: '1080p', width: 1920, height: 1080 },
  '4k': { label: '4K', width: 3840, height: 2160 },
} as const;

/** 分辨率预设键。 */
export type ResolutionPreset = keyof typeof RESOLUTION_PRESETS;

/** 导出计划入参。 */
export interface ExportPlanInput {
  width: number;
  height: number;
  fps: number;
  format: ExportFormat;
  videoBitrate: number;
  audioBitrate: number;
  burnInSubtitle: boolean;
}

/** 导出计划。 */
export interface ExportPlan {
  /** 总帧数 */
  totalFrames: number;
  /** 单帧时长（毫秒） */
  frameDurationMs: number;
  /** 总时长（毫秒） */
  durationMs: number;
  video: {
    width: number;
    height: number;
    fps: number;
    bitrate: number;
  };
  audio: {
    bitrate: number;
    sampleRate: number;
    channels: number;
  };
  /** 预计产物大小（字节，粗略估算） */
  estimatedSizeBytes: number;
  /** 错误列表（非法组合） */
  errors: string[];
  /** 降级建议 */
  suggestions: string[];
}

/** 超过该像素总量时提示 4K 降级。 */
const FOUR_K_PIXEL_COUNT = 3840 * 2160;

/** 单帧最多编码的像素数上限（超出时浏览器普遍无法硬解）。 */
const MAX_FRAME_PIXELS = 4096 * 2160;

/** 允许的最大帧率（导出场景）。 */
export const MAX_EXPORT_FPS = 60;

/**
 * 允许的最小帧率（导出场景）。
 *
 * ## 为什么有下限
 *
 * 导出时按 `timeMs = index * 1000 / fps` **离散采样**，`compositor.isActiveAt` 用半开区间
 * 判定。片段时长 < 帧周期且未跨越帧时刻时，**一次都不会被渲染** —— 该片段在成片里
 * 凭空消失，且没有任何报错（静默数据丢失）。
 *
 * 实测：100ms 片段在 fps=10 时正好 1 帧（安全下边界），fps=5 时 0 帧（整段消失）。
 *
 * 因此「最小片段时长 ≥ 100ms」与「帧率 ≥ 10fps」是**两道互补的防线**：
 * 只有前者，帧率被改低后照样丢帧；只有后者，超长片段仍安全。
 * 两者的关系由契约测试 `MIN_CLIP_DURATION_MS >= 1000 / MIN_EXPORT_FPS` 锁定。
 */
export const MIN_EXPORT_FPS = 10;

/**
 * 依据工程与导出设置构建导出计划。
 */
export function buildExportPlan(doc: ProjectDoc, input: ExportPlanInput): ExportPlan {
  const durationMs = Math.max(0, Math.round(doc.meta.durationMs));
  const rawFps = Math.round(input.fps);
  const fps = Math.min(MAX_EXPORT_FPS, Math.max(MIN_EXPORT_FPS, rawFps));
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));

  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const frameDurationMs = 1000 / fps;

  const errors: string[] = [];
  const suggestions: string[] = [];

  if (width * height > MAX_FRAME_PIXELS) {
    errors.push(`分辨率 ${width}×${height} 超出浏览器硬编码上限（约 4K）。`);
    suggestions.push('降至 1080p', '降至 720p');
  }

  if (width * height >= FOUR_K_PIXEL_COUNT && fps > 30) {
    errors.push(`4K@${fps} 通常超出浏览器硬编码能力，导出可能失败或极慢。`);
    suggestions.push('降至 30fps', '降至 1080p');
  }

  // 用**原始输入值**判断越界，这样即使已被钳制，用户仍能看到问题提示。
  if (rawFps > MAX_EXPORT_FPS) {
    errors.push(`帧率 ${rawFps} 超过导出支持的上限 ${MAX_EXPORT_FPS}。`);
    suggestions.push('降至 30fps');
  }

  // 帧率过低 → 短片段会被离散采样整段丢弃（静默数据丢失）。
  // 用**原始输入值**判断，这样即使已被钳到下限，用户仍能看到问题提示。
  if (rawFps < MIN_EXPORT_FPS) {
    errors.push(
      `帧率 ${rawFps} 过低：低于 ${MIN_EXPORT_FPS}fps 时，短于 ${Math.round(1000 / MIN_EXPORT_FPS)}ms 的片段` +
        `会在导出采样时被整段丢弃（成片里凭空消失且不报错）。`,
    );
    suggestions.push(`升至 ${MIN_EXPORT_FPS}fps`);
  }

  if (input.format === 'mp4' && durationMs > 0 && totalFrames > 60 * 60 * 10) {
    errors.push('时长超过 10 分钟，逐帧离线导出耗时可能不可接受。');
    suggestions.push('分段导出');
  }

  const bitrate = Math.max(0, Math.round(input.videoBitrate));
  const audioBitrate = Math.max(0, Math.round(input.audioBitrate));
  const estimatedSizeBytes = Math.round(((bitrate + audioBitrate) * durationMs) / 8000);

  return {
    totalFrames,
    frameDurationMs,
    durationMs,
    video: { width, height, fps, bitrate },
    audio: { bitrate: audioBitrate, sampleRate: 48_000, channels: 2 },
    estimatedSizeBytes,
    errors,
    suggestions,
  };
}

/**
 * 依据分辨率预设解析出实际宽高。
 */
export function resolveResolution(
  preset: ResolutionPreset,
  canvasWidth: number,
  canvasHeight: number,
): { width: number; height: number } {
  if (preset === 'canvas') {
    return { width: canvasWidth, height: canvasHeight };
  }
  const value = RESOLUTION_PRESETS[preset];
  return { width: value.width, height: value.height };
}
