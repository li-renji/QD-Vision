/**
 * 本地 HTTP Provider 骨架（Ollama / Whisper.cpp / ComfyUI）。
 *
 * ⚠️ V1.0 **空实现**：调用未实现的能力会抛 `ProviderNotImplementedError`
 * 并提示「该 Provider 将在 V1.5 实现」。
 *
 * 预期协议（V1.5 实现时参考）：
 * - ASR（Whisper.cpp server）：
 *   `POST {baseUrl}/inference` · multipart(form-data) · 字段 `file` + `temperature`
 *   → `{ "text": "...", "segments": [{ "start": 0.0, "end": 1.2, "text": "..." }] }`
 *   字段映射：`segments[].start`（秒）× 1000 → `startMs`。
 * - TTS（Ollama `/api/generate`）：
 *   `POST {baseUrl}/api/generate` · JSON `{ "model": model, "prompt": text, "stream": false }`
 *   → `{ "response": "..." }`（文本，不是音频）
 * - 人声分离（ComfyUI）：
 *   `POST {baseUrl}/prompt` · JSON 工作流 → `{ "prompt_id": "..." }`，
 *   随后轮询 `{baseUrl}/history/{prompt_id}` 取输出文件。
 */

import type { AICapability, AIInputMap, AIOutputMap } from '@clipcut/shared-types';
import { ProviderNotImplementedError } from '../errors.js';
import type { AIProvider, ProviderRunOptions } from '../provider.js';
import type { ProviderConfig } from '../config.js';
import { isConfigComplete } from '../config.js';

/** 本地 HTTP Provider 骨架。 */
export class LocalHttpProvider implements AIProvider {
  readonly id: string;

  readonly name: string;

  readonly kind = 'local' as const;

  readonly capabilities: readonly AICapability[];

  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig, options?: { id?: string; name?: string; capabilities?: AICapability[] }) {
    this.config = config;
    this.id = options?.id ?? 'local-http';
    this.name = options?.name ?? 'Local HTTP';
    this.capabilities = options?.capabilities ?? [
      'asr',
      'tts',
      'audioSeparation',
      'audioDenoise',
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
