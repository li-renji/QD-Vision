/**
 * Provider 配置与密钥掩码工具。
 *
 * 密钥**只保存在用户本机浏览器**（FR-048①），掩码显示形如 `sk-****abcd`。
 */

/** Provider 配置。 */
export interface ProviderConfig {
  /** local = 本地 HTTP 服务；cloud = 云 API；webgpu = 端侧推理 */
  type: 'local' | 'cloud' | 'webgpu';
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
}

/** 掩码 API Key：`sk-****abcd`。 */
export function maskApiKey(apiKey: string | null): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '****';
  const prefix = apiKey.slice(0, 3);
  const suffix = apiKey.slice(-4);
  return `${prefix}****${suffix}`;
}

/** 判断配置是否完整（可调用）。 */
export function isConfigComplete(config: ProviderConfig): boolean {
  if (config.type === 'webgpu') return true;
  if (!config.baseUrl) return false;
  if (config.type === 'cloud' && !config.apiKey) return false;
  return true;
}
