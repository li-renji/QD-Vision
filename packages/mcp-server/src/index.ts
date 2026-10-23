#!/usr/bin/env node
/**
 * stdio 入口：`npx clipcut-mcp-server` 可启动。
 *
 * 启动后：
 * 1. 创建 MCP Server 并注册 15 个工具；
 * 2. 启动 WebSocket 通道 host（Node 端，浏览器端做 client）；
 * 3. 通过 stdio 与外部 MCP 客户端通信。
 *
 * V1.0 的工具 handler 全部返回结构化 `NOT_IMPLEMENTED` 错误，**进程不会崩**。
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { ChannelServer } from './channel/wsServer.js';
import { WebSocketClipCutBridge } from './bridge/clipcutBridge.js';
import { decodeMessage, encodeMessage } from './channel/codec.js';
import { MCP_PROTOCOL_VERSION, type McpChannelMessage } from '@clipcut/shared-types';
import { WebSocketServer, type WebSocket } from 'ws';

/** 命令行参数。 */
interface CliOptions {
  port: number;
  host: string;
  token: string | null;
}

/**
 * 解析命令行参数。
 *
 * 用法：`clipcut-mcp-server [--port 8765] [--host 127.0.0.1] [--token xxx]`
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { port: 8765, host: '127.0.0.1', token: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--port':
        options.port = Number.parseInt(argv[i + 1] ?? '8765', 10);
        i += 1;
        break;
      case '--host':
        options.host = argv[i + 1] ?? '127.0.0.1';
        i += 1;
        break;
      case '--token':
        options.token = argv[i + 1] ?? null;
        i += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

/**
 * 启动 MCP Server。
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const logger = (message: string): void => {
    // stdout 已被 MCP stdio 占用，日志必须走 stderr。
    process.stderr.write(`${message}\n`);
  };

  logger(`[mcp] 协议版本 ${MCP_PROTOCOL_VERSION}`);

  // WebSocket host（浏览器端做 client）
  const channel = new ChannelServer({
    port: options.port,
    host: options.host,
    ...(options.token ? { token: options.token } : {}),
    logger,
  });
  channel.start();

  // 桥：把工具调用转发到通道
  const bridge = new WebSocketClipCutBridge({
    isConnected: () => channel.hasClient(),
    send: (message: McpChannelMessage) => {
      channel.broadcast(message);
      return channel.hasClient();
    },
    logger,
  });

  const server = createMcpServer({ bridge, logger });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger('[mcp] MCP Server 已启动（stdio），15 个工具已注册。');

  const shutdown = (): void => {
    channel.stop();
    void server.close().finally(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// 仅在直接运行时启动（便于测试 import）
const isDirectRun = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(`[mcp] 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

export { ChannelServer, WebSocketClipCutBridge, decodeMessage, encodeMessage, WebSocketServer };
export type { WebSocket };
