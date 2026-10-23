# @clipcut/ai-provider-sdk

ClipCut Web 的 **AI Provider 抽象与路由**包。

## 定位

| 维度 | 说明 |
| --- | --- |
| 职责 | 定义统一 `AIProvider` 接口、能力契约、注册表与路由（fallback 链） |
| **零厂商 SDK** | `dependencies` 只有 `@clipcut/shared-types`；厂商实现一律放在 `packages/app/src/providers/*` |
| 错误语义 | 未配置 → `ProviderNotConfiguredError`；未实现 → `ProviderNotImplementedError`（**不静默失败**） |

## V1.0 交付范围

本期（V1.0）**只交付接口与空实现骨架**：

- `LocalHttpProvider`（Ollama / Whisper.cpp / ComfyUI 协议注释）
- `CloudApiProvider`（OpenAI 兼容协议注释）
- `OnnxWebProvider`（WebGPU / WebNN / WASM 降级链注释）

三个骨架的 `run()` 一律抛 `ProviderNotImplementedError`，并附「该 Provider 将在 V1.5 实现」提示。
真实能力可用性时点仍按 V1.5 计（PRD §0）。

## 用法

```ts
import {
  ProviderRegistry,
  ProviderRouter,
  createDefaultProviders,
} from '@clipcut/ai-provider-sdk';

const registry = new ProviderRegistry();
for (const provider of createDefaultProviders()) registry.register(provider);

const router = new ProviderRouter({
  registry,
  routes: { asr: 'local-http' },
  fallbackChains: { asr: ['cloud-api'] },
});

// 未配置时抛 ProviderNotConfiguredError
router.resolve('tts');
```

## 扩展：实现一个新 Provider

```ts
import type { AIProvider } from '@clipcut/ai-provider-sdk';

class MyProvider implements AIProvider {
  readonly id = 'my-provider';
  readonly name = 'My Provider';
  readonly kind = 'local' as const;
  readonly capabilities = ['asr'] as const;

  isConfigured(): boolean {
    return true;
  }

  async run(capability, input, options) {
    options?.onProgress?.({ ratio: 0.5, stage: 'transcribing' });
    return { segments: [], text: '' };
  }
}
```

完整说明见 [`docs/ai/provider-api.md`](../../docs/ai/provider-api.md)。

## 依赖约束（CI 断言）

`pnpm why openai` 等在 `packages/ai-provider-sdk` 下必须为空；
CI 步骤见 `.github/workflows/ci.yml` 的
`Assert ai-provider-sdk has no vendor SDK dependency`。
