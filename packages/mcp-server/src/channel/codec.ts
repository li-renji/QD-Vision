/**
 * 通道消息编解码与超时/重试封装。
 */

import {
  MCP_PROTOCOL_VERSION,
  McpErrorCode,
  type McpChannelMessage,
} from '@clipcut/shared-types';
import { ChannelError, ChannelTimeoutError } from '../bridge/errors.js';

/** 编码为 JSON 文本。 */
export function encodeMessage(message: McpChannelMessage): string {
  return JSON.stringify(message);
}

/**
 * 解码通道消息。
 *
 * @throws ChannelError 消息格式非法
 */
export function decodeMessage(raw: string): McpChannelMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ChannelError(
      McpErrorCode.INTERNAL,
      `通道消息不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ChannelError(McpErrorCode.INTERNAL, '通道消息必须是对象。');
  }

  const message = parsed as { type?: unknown };
  if (typeof message.type !== 'string') {
    throw new ChannelError(McpErrorCode.INTERNAL, '通道消息缺少 type 字段。');
  }

  return parsed as McpChannelMessage;
}

/** 默认调用超时（毫秒）。 */
export const DEFAULT_CALL_TIMEOUT_MS = 15_000;

/** 调用参数。 */
export interface CallOptions {
  timeoutMs?: number;
  /** 重试次数（仅对通道瞬时错误重试）。 */
  retries?: number;
}

/**
 * 带超时与重试的调用封装。
 *
 * @param invoke 实际调用
 * @param options 超时 / 重试配置
 */
export async function callWithTimeout<T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  options: CallOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const retries = options.retries ?? 0;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      return await invoke(controller.signal);
    } catch (error) {
      lastError = error;
      if (controller.signal.aborted) {
        lastError = new ChannelTimeoutError(timeoutMs);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 握手请求。 */
export function createHello(clientId: string, token: string): McpChannelMessage {
  return {
    type: 'hello',
    protocolVersion: MCP_PROTOCOL_VERSION,
    clientId,
    token,
  };
}
