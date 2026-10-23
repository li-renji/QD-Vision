/**
 * 三个骨架 Provider 的统一导出。
 */

export { LocalHttpProvider } from './localHttp.js';
export { CloudApiProvider } from './cloudApi.js';
export { OnnxWebProvider } from './onnxWeb.js';

import type { ProviderConfig } from '../config.js';
import { LocalHttpProvider } from './localHttp.js';
import { CloudApiProvider } from './cloudApi.js';
import { OnnxWebProvider } from './onnxWeb.js';
import type { AIProvider } from '../provider.js';

/**
 * 创建默认的三个骨架 Provider。
 *
 * 它们的 `isConfigured()` 取决于传入的配置，但 `run()` 一律抛
 * `ProviderNotImplementedError`（V1.0 只交付接口与骨架）。
 */
export function createDefaultProviders(
  configs: Record<string, ProviderConfig> = {},
): AIProvider[] {
  return [
    new LocalHttpProvider(
      configs['local-http'] ?? { type: 'local', baseUrl: null, model: null, apiKey: null },
      { id: 'local-http' },
    ),
    new CloudApiProvider(
      configs['cloud-api'] ?? { type: 'cloud', baseUrl: null, model: null, apiKey: null },
      { id: 'cloud-api' },
    ),
    new OnnxWebProvider(
      configs['onnx-web'] ?? { type: 'webgpu', baseUrl: null, model: null, apiKey: null },
      { id: 'onnx-web' },
    ),
  ];
}
