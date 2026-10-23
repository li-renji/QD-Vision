/**
 * MCP ↔ 剪辑内核 WebSocket 通道协议（FR-054）。
 *
 * 方向说明：**浏览器不能监听端口**，因此 Node 端（MCP Server）做 WebSocket host，
 * 浏览器端（剪辑内核）做 client。
 */

/** 通道协议版本。 */
export const MCP_PROTOCOL_VERSION = '1.0.0';

/** 默认本地通道地址。 */
export const DEFAULT_MCP_WS_URL = 'ws://localhost:8765';

/** 通道错误码。 */
export enum McpErrorCode {
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  INVALID_ARGS = 'INVALID_ARGS',
  CHANNEL_DISCONNECTED = 'CHANNEL_DISCONNECTED',
  TIMEOUT = 'TIMEOUT',
  INTERNAL = 'INTERNAL',
}

/** 事件主题。 */
export type McpEventTopic = 'export.progress' | 'project.changed' | 'timeline.changed';

/** 通道错误负载。 */
export interface McpChannelError {
  code: McpErrorCode;
  message: string;
  data?: unknown;
}

/** 通道消息联合类型。 */
export type McpChannelMessage =
  | { type: 'hello'; protocolVersion: string; clientId: string; token: string }
  | { type: 'hello.ack'; protocolVersion: string; serverId: string; accepted: boolean; reason?: string }
  | { type: 'tool.call'; id: string; tool: string; args: unknown }
  | { type: 'tool.result'; id: string; ok: true; result: unknown }
  | { type: 'tool.result'; id: string; ok: false; error: McpChannelError }
  | { type: 'event'; topic: McpEventTopic; payload: unknown }
  | { type: 'ping' }
  | { type: 'pong' };

/** 消息类型判别。 */
export type McpChannelMessageType = McpChannelMessage['type'];

/** 握手请求（浏览器 client → Node host）。 */
export interface McpHelloRequest {
  type: 'hello';
  protocolVersion: string;
  clientId: string;
  token: string;
}

/** 握手响应。 */
export interface McpHelloAck {
  type: 'hello.ack';
  protocolVersion: string;
  serverId: string;
  accepted: boolean;
  reason?: string;
}

/** 判断一条消息是否为握手请求。 */
export function isHelloRequest(message: McpChannelMessage): message is McpHelloRequest {
  return message.type === 'hello';
}

/** 判断一条消息是否为握手响应。 */
export function isHelloAck(message: McpChannelMessage): message is McpHelloAck {
  return message.type === 'hello.ack';
}

/** 构造一个通道错误负载。 */
export function createChannelError(code: McpErrorCode, message: string, data?: unknown): McpChannelError {
  return data === undefined ? { code, message } : { code, message, data };
}
