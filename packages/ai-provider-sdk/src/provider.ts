/**
 * `AIProvider` 接口定义（ARCHITECTURE §6.2）。
 *
 * 本文件**不含任何厂商实现**——厂商实现必须放在 `packages/app/src/providers/*`，
 * 并通过本接口接入（CI 断言 `ai-provider-sdk` 依赖树中无厂商 SDK）。
 */

import type {
  AICapability,
  AIInputMap,
  AIOutputMap,
} from '@clipcut/shared-types';

/** 能力调用进度。 */
export interface ProviderProgress {
  /** 0~1 */
  ratio: number;
  stage?: string;
  message?: string;
}

/** 能力调用参数。 */
export interface ProviderRunOptions {
  onProgress?: (progress: ProviderProgress) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * AI Provider 接口。
 */
export interface AIProvider {
  /** 稳定唯一 ID，如 'local-whisper' */
  readonly id: string;
  readonly name: string;
  /** local = 本地 HTTP 服务；cloud = 云 API；webgpu = 端侧推理 */
  readonly kind: 'local' | 'cloud' | 'webgpu';
  /** 该 Provider 支持的能力子集 */
  readonly capabilities: readonly AICapability[];
  /** 是否已配置完成（缺 baseUrl / apiKey 时为 false） */
  isConfigured(): boolean;
  /**
   * 执行能力调用。
   *
   * @throws ProviderNotImplementedError 未实现的能力
   * @throws ProviderNotConfiguredError 未配置
   */
  run<K extends AICapability>(
    capability: K,
    input: AIInputMap[K],
    options?: ProviderRunOptions,
  ): Promise<AIOutputMap[K]>;
  /** 释放资源。 */
  dispose?(): void | Promise<void>;
}
