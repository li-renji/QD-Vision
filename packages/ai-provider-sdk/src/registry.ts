/**
 * Provider 注册表。
 */

import type { AICapability } from '@clipcut/shared-types';
import type { AIProvider } from './provider.js';

/**
 * Provider 注册表：注册 / 注销 / 按能力查询。
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  /** 注册一个 Provider（同名覆盖）。 */
  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** 注销一个 Provider。 */
  unregister(id: string): void {
    this.providers.delete(id);
  }

  /** 按 id 取 Provider。 */
  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  /** 列出全部 Provider。 */
  list(): AIProvider[] {
    return [...this.providers.values()];
  }

  /** 列出声明支持某能力的 Provider。 */
  listByCapability(capability: AICapability): AIProvider[] {
    return this.list().filter((provider) => provider.capabilities.includes(capability));
  }

  /** 清空注册表。 */
  clear(): void {
    this.providers.clear();
  }
}
