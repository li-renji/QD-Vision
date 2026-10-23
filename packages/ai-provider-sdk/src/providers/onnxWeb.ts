/**
 * 端侧 ONNX / WebGPU Provider 骨架。
 *
 * ⚠️ V1.0 **空实现**：调用未实现的能力会抛 `ProviderNotImplementedError`
 * 并提示「该 Provider 将在 V1.5 实现」。
 *
 * 预期降级链（V1.5 实现时参考）：
 * 1. `navigator.gpu` 可用 → WebGPU EP（`ort.env.wasm.numThreads` + `webgpu` backend）
 * 2. 否则 → WebNN（`navigator.ml`）
 * 3. 否则 → WASM SIMD 单线程
 *
 * 预期能力：
 * - `audioDenoise`：ONNX 降噪模型，输入 16kHz 单声道 PCM，返回同规格 PCM。
 * - `audioSeparation`：Demucs / Spleeter ONNX，输出 `vocals` 与 `accompaniment`。
 * - `caption`：端侧轻量视觉模型（可选）。
 *
 * 注：ONNX Runtime Web 属于「内置开箱 Provider」，不违反「零厂商 SDK」约束
 * （PRD C3 明确允许端侧 ONNX）。
 */

import type { AICapability, AIInputMap, AIOutputMap } from '@clipcut/shared-types';
import { ProviderNotImplementedError } from '../errors.js';
import type { AIProvider, ProviderRunOptions } from '../provider.js';
import type { ProviderConfig } from '../config.js';
import { isConfigComplete } from '../config.js';

/** 端侧 Provider 骨架。 */
export class OnnxWebProvider implements AIProvider {
  readonly id: string;

  readonly name: string;

  readonly kind = 'webgpu' as const;

  readonly capabilities: readonly AICapability[];

  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig, options?: { id?: string; name?: string; capabilities?: AICapability[] }) {
    this.config = config;
    this.id = options?.id ?? 'onnx-web';
    this.name = options?.name ?? 'ONNX Web';
    this.capabilities = options?.capabilities ?? [
      'audioDenoise',
      'audioSeparation',
      'caption',
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
