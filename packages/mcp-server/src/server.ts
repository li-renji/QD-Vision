/**
 * MCP Server 工厂（便于测试）。
 *
 * 采用**低层 `Server` API** + 原生 JSON Schema 注册工具：
 * 这样既不需要引入 Zod，又能直接复用 `shared-types` 里的 JSON Schema 常量。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpErrorCode } from '@clipcut/shared-types';
import type { ClipCutBridge } from './bridge/clipcutBridge.js';
import { toChannelError } from './bridge/errors.js';
import { allToolDefinitions, invokeTool } from './tools/index.js';

/** MCP Server 依赖。 */
export interface McpServerDeps {
  /** 与剪辑内核通信的桥。 */
  bridge: ClipCutBridge;
  /** 日志。 */
  logger?: (msg: string) => void;
  /** 服务名。 */
  name?: string;
  /** 版本。 */
  version?: string;
}

/**
 * 创建 MCP Server 并注册 15 个工具。
 */
export function createMcpServer(deps: McpServerDeps): Server {
  const { bridge, logger } = deps;
  const server = new Server(
    {
      name: deps.name ?? 'clipcut-mcp-server',
      version: deps.version ?? '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolDefinitions.map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema as { type: 'object' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger?.(`[mcp] tools/call ${name}`);

    try {
      const result = await invokeTool(bridge, name, args ?? {});
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const channelError = toChannelError(error);
      logger?.(`[mcp] 工具 ${name} 失败：${channelError.message}`);
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: {
                  code: channelError.code,
                  message: channelError.message,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  });

  return server;
}

/** 供外部复用的错误码。 */
export { McpErrorCode };
