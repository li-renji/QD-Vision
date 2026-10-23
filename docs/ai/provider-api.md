# 如何实现一个新的 AI Provider

> 对应 PRD FR-046 ~ FR-049 · 架构见 [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §6.2

## 1. 设计原则

| 原则 | 说明 |
| --- | --- |
| **零厂商 SDK** | `packages/ai-provider-sdk` 不得依赖任何厂商 SDK（CI 断言）。厂商实现只能放在 `packages/app/src/providers/**` |
| **统一接口** | 所有能力都通过 `AIProvider` 接口暴露，业务层不感知具体厂商 |
| **不静默失败** | 未配置 → `ProviderNotConfiguredError`；未实现 → `ProviderNotImplementedError`；超时 → `ProviderTimeoutError` |
| **可取消** | `run()` 接受 `AbortSignal`，长任务必须响应取消 |

## 2. 最小示例（可直接复制）

```ts
// packages/app/src/providers/myProvider.ts
import type { AIProvider, ProviderProgress, ProviderRunOptions } from '@clipcut/ai-provider-sdk';
import type { AICapability, AIInputMap, AIOutputMap } from '@clipcut/shared-types';

export class MyProvider implements AIProvider {
  readonly id = 'my-provider';
  readonly name = 'My Provider';
  readonly kind = 'local' as const;
  readonly capabilities: readonly AICapability[] = ['asr'];

  isConfigured(): boolean {
    // 缺少 baseUrl / apiKey 时返回 false，路由层会抛 ProviderNotConfiguredError
    return true;
  }

  async run<K extends AICapability>(
    capability: K,
    input: AIInputMap[K],
    options?: ProviderRunOptions,
  ): Promise<AIOutputMap[K]> {
    const report = (p: ProviderProgress): void => options?.onProgress?.(p);

    if (capability === 'asr') {
      report({ ratio: 0.1, stage: 'uploading' });
      // ... 实际调用
      report({ ratio: 1, stage: 'done' });
      return { segments: [], text: '' } as AIOutputMap[K];
    }

    throw new ProviderNotImplementedError(
      `Provider「${this.name}」尚未实现能力「${capability}」，该 Provider 将在 V1.5 实现。`,
    );
  }

  dispose(): void {
    // 释放连接 / 句柄
  }
}
```

## 3. 注册与路由

```ts
import { ProviderRegistry, ProviderRouter } from '@clipcut/ai-provider-sdk';

const registry = new ProviderRegistry();
registry.register(new MyProvider());

const router = new ProviderRouter({
  registry,
  // 来自工程 settings.ai.routes
  routes: { asr: 'my-provider' },
  // 每个能力的 fallback 链，按顺序尝试
  fallbackChains: { asr: ['local-http', 'cloud-api'] },
});

const result = await router.run('asr', { audio: blob });
```

未配置时 `router.resolve('tts')` 会抛 `ProviderNotConfiguredError`（不静默失败）。

## 4. 七大能力契约

| 能力 | 输入 | 输出 |
| --- | --- | --- |
| `asr` | `{ audio: Blob; language?: string }` | `{ segments: Array<{ startMs; endMs; text }>; text: string }` |
| `tts` | `{ text: string; voice?: string }` | `{ audio: Blob; mimeType: string }` |
| `audioSeparation` | `{ audio: Blob }` | `{ vocals: Blob; accompaniment: Blob }` |
| `audioDenoise` | `{ audio: Blob }` | `{ audio: Blob }` |
| `objectRemoval` | `{ video: Blob; mask: Blob }` | `{ video: Blob }` |
| `videoToVideo` | `{ image: Blob; prompt: string; durationMs?: number }` | `{ video: Blob }` |
| `caption` | `{ video: Blob; language?: string }` | `{ cues: Array<{ startMs; endMs; text }> }` |

### 进度回调

```ts
options?.onProgress?.({ ratio: 0.42, stage: 'transcribing', message: '正在识别…' });
```

`ratio` 必须是 `0~1` 的单调递增数值。

### 错误类型

| 错误 | 何时抛出 |
| --- | --- |
| `ProviderNotConfiguredError` | 缺少 `baseUrl` / `apiKey` |
| `ProviderNotImplementedError` | 该 Provider 未声明/未实现此能力 |
| `ProviderTimeoutError` | 超过 `options.timeoutMs` |
| `ProviderError` | 其它厂商错误（`code` 区分） |

## 5. 三个内置骨架的预期协议

| Provider | 类型 | 预期协议 |
| --- | --- | --- |
| `LocalHttpProvider` | local | Ollama `/api/generate`、Whisper.cpp `/inference`、ComfyUI `/prompt` + `/history` |
| `CloudApiProvider` | cloud | OpenAI 兼容：`/v1/audio/transcriptions`、`/v1/audio/speech`、`/v1/chat/completions` |
| `OnnxWebProvider` | webgpu | WebGPU → WebNN → WASM 三级降级链 |

字段映射示例（ASR）：

```
厂商 segments[].start（秒） → startMs = start × 1000
厂商 segments[].end（秒）   → endMs   = end × 1000
```

## 6. 安全约束

- API Key **只保存在用户本机浏览器**（IndexedDB），UI 掩码显示（`sk-****abcd`）。
- Provider 发起网络请求属于**用户主动配置**的行为，是「零上传」约束的唯一例外。
- 素材字节本身绝不允许随能力请求上传，除非用户显式选择了对应的云端能力。
