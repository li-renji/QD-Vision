/**
 * 云 API Provider 骨架（OpenAI 兼容协议）。
 *
 * ⚠️ V1.0 **空实现**：调用未实现的能力会抛 `ProviderNotImplementedError`
 * 并提示「该 Provider 将在 V1.5 实现」。
 *
 * 预期协议（V1.5 实现时参考）：
 * - ASR（`POST {baseUrl}/v1/audio/transcriptions`）：
 *   multipart(form-data) · 字段 `file` + `model` + `language`
 *   → `{ "text": "...", "segments": [{ "start": 0.0, "end": 1.2, "text": "..." }] }`
 *   鉴权头：`Authorization: Bearer {apiKey}`。
 * - TTS（`POST {baseUrl}/v1/audio/speech`）：
 *   JSON `{ "model": model, "input": text, "voice": voice }`
 *   → 二进制音频（`audio/mpeg`）。
 * - 视频理解（`POST {baseUrl}/v1/chat/completions`）：
 *   JSON `{ "model": model, "messages": [...] }` → `{ "choices": [{ "message": { "content": "..." } }] }`。
 */

import type { AICapability, AIInputMap, AIOutputMap } from '@clipcut/shared-types';
import { ProviderNotImplementedError } from '../errors.js';
import type { AIProvider, ProviderRunOptions } from '../provider.js';
import type { ProviderConfig } from '../config.js';
import { isConfigComplete } from '../config.js';

/** 云 API Provider 骨架。 */
export class CloudApiProvider implements AIProvider {
  readonly id: string;

  readonly name: string;

  readonly kind = 'cloud' as const;

  readonly capabilities: readonly AICapability[];

  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig, options?: { id?: string; name?: string; capabilities?: AICapability[] }) {
    this.config = config;
    this.id = options?.id ?? 'cloud-api';
    this.name = options?.name ?? 'Cloud API';
    this.capabilities = options?.capabilities ?? [
      'asr',
      'tts',
      'caption',
      'videoToVideo',
      'objectRemoval',
    ];
  }

  isConfigured(): boolean {
    return isConfigComplete(this.config);
  }

  async run<K extends AICapability>(
    capability: K,
    _input: AIInputMap[K],
    _options?: ProviderRunOptions,
  ): Promise<AIOutputMap[K]> {
    throw new ProviderNotImplementedError(
      `Provider「${this.name}」尚未实现能力「${capability}」，该 Provider 将在 V1.5 实现。`,
    );
  }
}
