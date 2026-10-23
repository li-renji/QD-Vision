/**
 * Provider 路由：按能力路由 + 多 Provider fallback 链。
 */

import type { AICapability, AIInputMap, AIOutputMap } from '@clipcut/shared-types';
import type { AIProvider, ProviderRunOptions } from './provider.js';
import type { ProviderRegistry } from './registry.js';
import { ProviderNotConfiguredError } from './errors.js';

/** 路由配置。 */
export interface ProviderRouterOptions {
  registry: ProviderRegistry;
  /** capability → providerId 映射（来自工程 settings.ai.routes） */
  routes: Partial<Record<AICapability, string | null>>;
  /** 每个能力的 fallback 链，按顺序尝试。 */
  fallbackChains?: Partial<Record<AICapability, string[]>>;
}

/** 能力状态。 */
export interface ProviderStatus {
  capability: AICapability;
  providerId: string | null;
  configured: boolean;
}

/**
 * Provider 路由器。
 */
export class ProviderRouter {
  private readonly registry: ProviderRegistry;

  private routes: Partial<Record<AICapability, string | null>>;

  private readonly fallbackChains: Partial<Record<AICapability, string[]>>;

  constructor(options: ProviderRouterOptions) {
    this.registry = options.registry;
    this.routes = options.routes;
    this.fallbackChains = options.fallbackChains ?? {};
  }

  /** 更新路由配置。 */
  setRoutes(routes: Partial<Record<AICapability, string | null>>): void {
    this.routes = routes;
  }

  /**
   * 解析某能力对应的 Provider。
   *
   * @throws ProviderNotConfiguredError 未配置或 Provider 不存在
   */
  resolve(capability: AICapability): AIProvider {
    const providerId = this.routes[capability];
    if (!providerId) {
      throw new ProviderNotConfiguredError(
        `能力「${capability}」未配置 Provider，请在设置面板中选择。`,
      );
    }
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new ProviderNotConfiguredError(
        `能力「${capability}」配置的 Provider「${providerId}」不存在。`,
      );
    }
    if (!provider.isConfigured()) {
      throw new ProviderNotConfiguredError(
        `Provider「${providerId}」尚未配置完成（缺少 baseUrl 或 apiKey）。`,
      );
    }
    return provider;
  }

  /**
   * 按 fallback 链依次尝试执行能力调用。
   *
   * 全失败才抛错。
   */
  async run<K extends AICapability>(
    capability: K,
    input: AIInputMap[K],
    options?: ProviderRunOptions,
  ): Promise<AIOutputMap[K]> {
    const chain = this.buildChain(capability);
    if (chain.length === 0) {
      throw new ProviderNotConfiguredError(
        `能力「${capability}」未配置 Provider，请在设置面板中选择。`,
      );
    }

    let lastError: unknown = null;
    for (const provider of chain) {
      if (!provider.isConfigured()) continue;
      try {
        return await provider.run(capability, input, options);
      } catch (error) {
        lastError = error;
      }
    }

    throw new ProviderNotConfiguredError(
      `能力「${capability}」的所有候选 Provider 均调用失败：${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  /** 列出各能力的状态。 */
  listStatus(): ProviderStatus[] {
    const capabilities: AICapability[] = [
      'asr',
      'tts',
      'audioSeparation',
      'audioDenoise',
      'objectRemoval',
      'videoToVideo',
      'caption',
    ];
    return capabilities.map((capability) => {
      const providerId = this.routes[capability] ?? null;
      const provider = providerId ? this.registry.get(providerId) : undefined;
      return {
        capability,
        providerId,
        configured: provider ? provider.isConfigured() : false,
      };
    });
  }

  /** 构造尝试顺序：主路由 → fallback 链。 */
  private buildChain(capability: AICapability): AIProvider[] {
    const chain: AIProvider[] = [];
    const push = (id: string | null | undefined): void => {
      if (!id) return;
      const provider = this.registry.get(id);
      if (provider && !chain.includes(provider)) chain.push(provider);
    };

    push(this.routes[capability]);
    for (const id of this.fallbackChains[capability] ?? []) {
      push(id);
    }
    return chain;
  }
}
