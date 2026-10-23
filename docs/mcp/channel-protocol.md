# MCP ↔ 剪辑内核 通道协议

> 对应 PRD FR-052 ~ FR-055 · 架构见 [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §2.3 / §6.3

## 1. 方向与拓扑

> **浏览器不能监听端口**，因此通道方向是物理约束：
> **Node 端（MCP Server）做 WebSocket host，浏览器端（剪辑内核）做 client。**

```
┌────────────────────┐   stdio    ┌────────────────────┐   WebSocket   ┌──────────────────┐
│  外部 MCP 客户端    │ ─────────▶ │  mcp-server (Node) │ ────────────▶ │ 剪辑内核（浏览器）│
│ (Claude / 自建Agent)│ ◀───────── │                    │ ◀──────────── │                  │
└────────────────────┘            └────────────────────┘                └──────────────────┘
```

- 传输：WebSocket，默认 `ws://127.0.0.1:8765`
- 编码：UTF-8 JSON（一条消息一个 JSON 对象）
- 协议版本：`1.0.0`（`MCP_PROTOCOL_VERSION`）

## 2. 消息类型总表

| `type` | 方向 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `hello` | browser → node | `{ protocolVersion, clientId, token }` | 握手请求 |
| `hello.ack` | node → browser | `{ protocolVersion, serverId, accepted, reason? }` | 握手响应 |
| `tool.call` | node → browser | `{ id, tool, args }` | 工具调用 |
| `tool.result` | browser → node | `{ id, ok: true, result }` | 工具成功 |
| `tool.result` | browser → node | `{ id, ok: false, error: { code, message, data? } }` | 工具失败 |
| `event` | browser → node | `{ topic, payload }` | 事件推送 |
| `ping` | 双向 | — | 心跳 |
| `pong` | 双向 | — | 心跳响应 |

事件主题（`topic`）：

| 主题 | payload |
| --- | --- |
| `export.progress` | `{ jobId, ratio, currentTimeMs, estimatedRemainingMs }` |
| `project.changed` | `{ projectId, updatedAt }` |
| `timeline.changed` | `{ tracks: TrackSnapshot[] }` |

## 3. 握手时序

```
browser (client)                       node (host)
      │                                      │
      │ ─────── hello{token} ───────────────▶ │
      │                                      │ 校验 token
      │                                      │ 校验 protocolVersion
      │ ◀────── hello.ack{accepted} ──────── │
      │                                      │
      │ ◀────── tool.call{id, tool} ──────── │
      │ ─────── tool.result{id, ok} ───────▶ │
```

- **配对 Token**：用户在设置面板生成；`--token` 传入 Node 端。
  Token 不匹配时 host 返回 `accepted: false` 并关闭连接。
- **协议版本不匹配**：`hello.ack.accepted = false`，`reason` 说明原因。

## 4. 工具调用

### 4.1 15 个工具

| 分类 | 工具 |
| --- | --- |
| 工程 | `project.get_info`、`project.list_assets` |
| 时间线 | `timeline.get_state`、`timeline.add_track`、`timeline.remove_track`、`timeline.add_clip`、`timeline.split_clip`、`timeline.trim_clip`、`timeline.move_clip`、`timeline.delete_clip`、`timeline.set_clip_property` |
| 文字 | `text.create_overlay` |
| 字幕 | `subtitle.import_srt` |
| 导出 | `export.start`、`export.get_status` |

每个工具的完整入参 / 出参 JSON Schema 见
[`packages/shared-types/src/mcp/tools.ts`](../../packages/shared-types/src/mcp/tools.ts)。

### 4.2 请求示例

```json
{
  "type": "tool.call",
  "id": "call_1",
  "tool": "timeline.split_clip",
  "args": { "clipId": "clip_x1", "atMs": 4000 }
}
```

### 4.3 成功响应

```json
{
  "type": "tool.result",
  "id": "call_1",
  "ok": true,
  "result": { "leftClipId": "clip_a", "rightClipId": "clip_b" }
}
```

### 4.4 失败响应

```json
{
  "type": "tool.result",
  "id": "call_1",
  "ok": false,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "工具「timeline.split_clip」在 ClipCut Web V1.0 中为设计骨架，尚未实现。"
  }
}
```

## 5. 错误码表

| 码 | 含义 | 触发条件 |
| --- | --- | --- |
| `NOT_IMPLEMENTED` | V1.0 尚未实现 | 调用骨架工具 |
| `INVALID_ARGS` | 入参非法 | 参数校验失败 |
| `CHANNEL_DISCONNECTED` | 通道断开 | 浏览器未连接 / 连接被关闭 |
| `TIMEOUT` | 调用超时 | 超过 `timeoutMs`（默认 15s） |
| `INTERNAL` | 内部错误 | 其它未分类异常 |

错误码 → MCP 错误的映射见
[`packages/mcp-server/src/bridge/errors.ts`](../../packages/mcp-server/src/bridge/errors.ts)。

## 6. V1.0 行为约定

- 所有 15 个工具的 handler 返回**结构化 `NOT_IMPLEMENTED` 错误**，**进程不会崩溃**。
- 浏览器端在收到 `tool.call` 但尚未实现时，同样返回 `NOT_IMPLEMENTED`。
- 通道断开时所有工具调用立即返回 `CHANNEL_DISCONNECTED`，不做静默重试。
- 心跳：`ping` / `pong`，建议 30s 一次；连续 3 次未响应视为断线。

## 7. 安全

- 只监听 `127.0.0.1`，**不对外网暴露**。
- 配对 Token 防止同机其它进程误连。
- 通道内传输的只有工程元数据与指令，**素材字节不走通道**（素材只在本机 IndexedDB）。
