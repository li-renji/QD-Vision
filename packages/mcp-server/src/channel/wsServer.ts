/**
 * WebSocket **host**（Node 侧）。
 *
 * ⚠️ 方向说明：**浏览器不能监听端口**，因此 Node 端（MCP Server）做 host，
 * 浏览器端（剪辑内核）做 client。
 */

import { WebSocketServer, type WebSocket } from 'ws';
import {
  MCP_PROTOCOL_VERSION,
  McpErrorCode,
  type McpChannelMessage,
} from '@clipcut/shared-types';
import { decodeMessage, encodeMessage } from './codec.js';

/** 默认监听地址。 */
export const DEFAULT_WS_PORT = 8765;

/** 默认监听主机。 */
export const DEFAULT_WS_HOST = '127.0.0.1';

/** host 配置。 */
export interface WsServerOptions {
  port?: number;
  host?: string;
  /** 配对 Token：浏览器端握手时必须提供。 */
  token?: string;
  /** 日志。 */
  logger?: (message: string) => void;
}

/** 已连接的客户端。 */
interface ConnectedClient {
  socket: WebSocket;
  clientId: string;
}

/**
 * 通道 host。
 */
export class ChannelServer {
  private readonly options: Required<Pick<WsServerOptions, 'port' | 'host'>> & WsServerOptions;

  private wss: WebSocketServer | null = null;

  private readonly clients = new Set<ConnectedClient>();

  constructor(options: WsServerOptions = {}) {
    this.options = {
      port: options.port ?? DEFAULT_WS_PORT,
      host: options.host ?? DEFAULT_WS_HOST,
      ...(options.token !== undefined ? { token: options.token } : {}),
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
    };
  }

  /** 启动监听。 */
  start(): void {
    if (this.wss) return;
    const wss = new WebSocketServer({ port: this.options.port, host: this.options.host });
    this.wss = wss;

    wss.on('connection', (socket: WebSocket) => {
      const client: ConnectedClient = { socket, clientId: '' };
      this.clients.add(client);
      this.options.logger?.(`[mcp] 客户端已连接（当前 ${this.clients.size} 个）`);

      socket.on('message', (data: unknown) => {
        const raw = typeof data === 'string' ? data : String(data);
        let message: McpChannelMessage;
        try {
          message = decodeMessage(raw);
        } catch (error) {
          this.options.logger?.(
            `[mcp] 收到非法消息：${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }

        if (message.type === 'hello') {
          const accepted =
            !this.options.token || this.options.token === message.token;
          client.clientId = message.clientId;
          this.send(socket, {
            type: 'hello.ack',
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverId: 'clipcut-mcp-server',
            accepted,
            ...(accepted ? {} : { reason: '配对 Token 不匹配。' }),
          });
          if (!accepted) {
            socket.close();
          }
          return;
        }

        // V1.0 只做骨架：收到 tool.call 时统一返回 NOT_IMPLEMENTED
        if (message.type === 'tool.call') {
          this.send(socket, {
            type: 'tool.result',
            id: message.id,
            ok: false,
            error: {
              code: McpErrorCode.NOT_IMPLEMENTED,
              message: `工具「${message.tool}」在 V1.0 中为设计骨架，尚未实现（not implemented in v1.0）。`,
            },
          });
        }
      });

      socket.on('close', () => {
        this.clients.delete(client);
        this.options.logger?.(`[mcp] 客户端已断开（当前 ${this.clients.size} 个）`);
      });

      socket.on('error', (error: Error) => {
        this.options.logger?.(`[mcp] 通道错误：${error.message}`);
      });
    });

    this.options.logger?.(
      `[mcp] 通道 host 已启动：ws://${this.options.host}:${this.options.port}`,
    );
  }

  /** 停止监听。 */
  stop(): void {
    for (const client of this.clients) {
      try {
        client.socket.close();
      } catch {
        // 已关闭
      }
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }

  /** 是否已有客户端连接。 */
  hasClient(): boolean {
    return this.clients.size > 0;
  }

  /** 发送一条消息给所有客户端。 */
  broadcast(message: McpChannelMessage): void {
    for (const client of this.clients) {
      this.send(client.socket, message);
    }
  }

  /** 发送一条消息。 */
  private send(socket: WebSocket, message: McpChannelMessage): void {
    if (socket.readyState !== 1) return;
    try {
      socket.send(encodeMessage(message));
    } catch (error) {
      this.options.logger?.(
        `[mcp] 发送失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
