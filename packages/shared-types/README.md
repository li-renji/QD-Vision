# @clipcut/shared-types

QD视界的**跨包类型与协议包**。

## 设计原则

- **零运行时依赖**：`dependencies` 为空对象，只产出 `.d.ts` 与常量。
- **零业务逻辑**：除少量纯函数（时间码换算）外不含任何逻辑，便于被任意外部项目引用。
- **单向依赖**：只允许 `app` / `ai-provider-sdk` / `mcp-server` 依赖本包，本包不依赖任何其它包。

## 内容

| 文件 | 内容 |
| --- | --- |
| `src/project.ts` | 工程模型：`ProjectDoc` / `Track` / `Clip` / `Asset` / `SubtitleDoc` / `ProjectSettings` 等 |
| `src/time.ts` | 时间工具：帧换算、时间码格式化与解析 |
| `src/common.ts` | 通用类型：`Result<T>` / `Disposable` / `DeepReadonly` 等 |
| `src/ai-capabilities.ts` | AI 七能力枚举与输入/输出映射、进度与错误类型 |
| `src/mcp/tools.ts` | 15 个 MCP 工具的入参/出参 TS 类型 + JSON Schema |
| `src/mcp/protocol.ts` | MCP ↔ 剪辑内核 WebSocket 通道协议与错误码 |

## 约定

- 时间单位统一为**毫秒整数**。
- 含可扩展结构的接口都带 `[extra: string]: unknown` 索引签名，用于**保留未知字段**（forward-compatible）。
- 字段命名一律 `camelCase`；时间后缀 `Ms`，字节 `sizeBytes`，角度 `rotation`（度）。

## 用法

```ts
import type { ProjectDoc } from '@clipcut/shared-types'
import { formatTimecode, msToFrames } from '@clipcut/shared-types'

const frames = msToFrames(1234, 30) // 37
const tc = formatTimecode(1234, 30) // '00:00:01:07'
```
