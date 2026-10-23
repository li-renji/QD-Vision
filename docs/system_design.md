# 系统设计索引

> 本页是设计文档的导航。**实现以 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 为准。**

## 文档地图

| 文档 | 作用 | 读者 |
| --- | --- | --- |
| [`PRD.md`](./PRD.md) | 产品需求：FR-001 ~ FR-062、验收总纲 | 产品 / 测试 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 分层架构、类型定义、接口定义、文件清单 | 工程师 |
| [`TASKS.md`](./TASKS.md) | 20 个任务的实现分解与验收标准 | 工程师 / PM |
| [`ai/provider-api.md`](./ai/provider-api.md) | AI Provider 扩展指南 | 生态开发者 |
| [`mcp/channel-protocol.md`](./mcp/channel-protocol.md) | MCP ↔ 剪辑内核通道协议 | Agent 开发者 |

## 图

| 文件 | 内容 |
| --- | --- |
| [`class-diagram.mermaid`](./class-diagram.mermaid) | 核心类型类图（工程模型 / 状态层 / Provider） |
| [`sequence-diagram.mermaid`](./sequence-diagram.mermaid) | 关键流程时序图（导入 / 渲染 / 播放 / 导出 / MCP） |
| [`diagrams/seq-1-asset-import.mermaid`](./diagrams/seq-1-asset-import.mermaid) | 素材导入时序 |
| [`diagrams/seq-2-timeline-render.mermaid`](./diagrams/seq-2-timeline-render.mermaid) | 时间线渲染时序 |
| [`diagrams/seq-3-playback.mermaid`](./diagrams/seq-3-playback.mermaid) | 播放时序 |
| [`diagrams/seq-4-export.mermaid`](./diagrams/seq-4-export.mermaid) | 导出时序 |
| [`diagrams/seq-5-mcp-tool-call.mermaid`](./diagrams/seq-5-mcp-tool-call.mermaid) | MCP 工具调用时序 |

## 一句话架构

> 一个纯静态的浏览器应用，内部分为「纯领域层（可单测）+ 平台适配层（可替换）+ 渲染/导出引擎（无 UI 依赖）」，
> 通过 WebSocket 本地通道对外暴露 MCP 工具，所有浏览器 API 收敛到 `PlatformBridge` 之后。

## 分层速查

| 层 | 目录 / 包 | 铁律 |
| --- | --- | --- |
| 表现层 | `packages/app/src/components` | 只调用 `state/actions.ts`，不直接改 doc |
| 状态层 | `packages/app/src/state` | 只通过领域层纯函数改数据 |
| 领域层 | `packages/app/src/domain` | 零 DOM / 零 fetch / 零 IndexedDB |
| 服务层 | `packages/app/src/services` | 浏览器 API 只能经 `PlatformBridge` |
| 平台层 | `packages/app/src/platform` | 唯一允许直接访问 `window.*` 文件/存储 API |
| 引擎层 | `packages/app/src/render` | 不知道 React 存在，预览与导出复用 |
| 协议包 | `packages/shared-types` | 零运行时依赖 |
| AI 包 | `packages/ai-provider-sdk` | 零厂商 SDK 依赖 |
| MCP 包 | `packages/mcp-server` | 不依赖 `app` |
