/**
 * AI 能力契约（FR-046 / FR-047）。
 *
 * 本文件只定义**接口与数据形状**，不包含任何厂商协议实现。
 * 厂商实现位于 `packages/app/src/providers/*`，统一实现 `AIProvider` 接口。
 */

/** AI 能力枚举（七项）。 */
export type AICapability =
  | 'asr'
  | 'tts'
  | 'audioSeparation'
  | 'audioDenoise'
  | 'objectRemoval'
  | 'videoToVideo'
  | 'caption';

/** 全部能力（有序，便于 UI 展示）。 */
export const AI_CAPABILITIES: readonly AICapability[] = [
  'asr',
  'tts',
  'audioSeparation',
  'audioDenoise',
  'objectRemoval',
  'videoToVideo',
  'caption',
] as const;

/** 能力的中文名（设置面板展示用）。 */
export const AI_CAPABILITY_LABELS: Readonly<Record<AICapability, string>> = {
  asr: '语音识别',
  tts: '文本朗读',
  audioSeparation: '人声分离',
  audioDenoise: '音频降噪',
  objectRemoval: '智能消除',
  videoToVideo: '图生视频',
  caption: '生成字幕',
};

/** 各能力的输入形状。 */
export interface AIInputMap {
  asr: { audio: Blob; language?: string };
  tts: { text: string; voice?: string };
  audioSeparation: { audio: Blob };
  audioDenoise: { audio: Blob };
  objectRemoval: { video: Blob; mask: Blob };
  videoToVideo: { image: Blob; prompt: string; durationMs?: number };
  caption: { video: Blob; language?: string };
}

/** 各能力的输出形状。 */
export interface AIOutputMap {
  asr: { segments: Array<{ startMs: number; endMs: number; text: string }>; text: string };
  tts: { audio: Blob; mimeType: string };
  audioSeparation: { vocals: Blob; accompaniment: Blob };
  audioDenoise: { audio: Blob };
  objectRemoval: { video: Blob };
  videoToVideo: { video: Blob };
  caption: { cues: Array<{ startMs: number; endMs: number; text: string }> };
}

/** 能力调用进度。 */
export interface AIProgressEvent {
  /** 0~1 */
  ratio: number;
  /** 阶段名，如 'transcribing' */
  stage?: string;
  /** 人类可读提示 */
  message?: string;
}

/** 能力调用的错误码。 */
export type AIErrorCode =
  | 'NOT_CONFIGURED'
  | 'NOT_IMPLEMENTED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_INPUT'
  | 'CANCELLED'
  | 'INTERNAL';

/** 能力调用错误。 */
export interface AIError {
  code: AIErrorCode;
  message: string;
  /** 原始错误（若来自底层实现） */
  cause?: unknown;
}

/** 能力是否被某个 Provider 声明支持。 */
export function isAICapability(value: unknown): value is AICapability {
  return typeof value === 'string' && (AI_CAPABILITIES as readonly string[]).includes(value);
}
