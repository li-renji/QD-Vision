# @clipcut/mcp-server

ClipCut Web 的 **MCP Server 骨架**（stdio + WebSocket 本地通道）。

## V1.0 交付范围

本期（V1.0）**只交付设计骨架**：

| 项 | 状态 |
| --- | --- |
| 15 个工具的入参 / 出参 JSON Schema | ✅ 已定义（`@clipcut/shared-types` 的 `MCP_TOOL_DEFINITIONS`） |
| 工具 handler | ⚠️ 全部返回结构化 `NOT_IMPLEMENTED` 错误，**进程不崩** |
| WebSocket 通道 host（Node 端） | ✅ 骨架 + 配对 Token 握手 |
| 通道编解码 + 超时/重试 | ✅ 已实现 |
| 真实工具实现 | ❌ V1.5（PRD §0） |

## 启动方式

```bash
# 在 MCP 客户端（如 Claude Desktop）中配置：
{
  "mcpServers": {
    "clipcut": {
      "command": "npx",
      "args": ["clipcut-mcp-server"]
    }
  }
}
```

命令行参数：

```bash
clipcut-mcp-server [--port 8765] [--host 127.0.0.1] [--token <配对Token>]
```

- `--port`：WebSocket 通道端口，默认 `8765`
- `--host`：监听地址，默认 `127.0.0.1`（仅本机可连）
- `--token`：配对 Token，防止同机其它进程误连

## 通道方向（重要）

> **浏览器不能监听端口**，因此方向必须是 **Node 端做 WebSocket host，浏览器端（剪辑内核）做 client**。

协议详见 [`docs/mcp/channel-protocol.md`](../../docs/mcp/channel-protocol.md)。

## 工具清单（15 个）

| 分类 | 工具 |
| --- | --- |
| 工程 | `project.get_info`、`project.list_assets` |
| 时间线 | `timeline.get_state`、`timeline.add_track`、`timeline.remove_track`、`timeline.add_clip`、`timeline.split_clip`、`timeline.trim_clip`、`timeline.move_clip`、`timeline.delete_clip`、`timeline.set_clip_property` |
| 文字 | `text.create_overlay` |
| 字幕 | `subtitle.import_srt` |
| 导出 | `export.start`、`export.get_status` |

## 错误码

| 码 | 含义 |
| --- | --- |
| `NOT_IMPLEMENTED` | V1.0 骨架尚未实现该能力 |
| `INVALID_ARGS` | 入参非法 |
| `CHANNEL_DISCONNECTED` | 与剪辑内核的通道断开 |
| `TIMEOUT` | 调用超时 |
| `INTERNAL` | 其它内部错误 |

## 依赖约束

只依赖 `@clipcut/shared-types` + `@modelcontextprotocol/sdk` + `ws`；
**不依赖 `packages/app`**（保证未来可拆为独立仓库）。
