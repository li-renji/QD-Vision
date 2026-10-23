/**
 * 通道错误 → MCP 错误码映射。
 */

import { McpErrorCode } from '@clipcut/shared-types';

/** 通道错误。 */
export class ChannelError extends Error {
  readonly code: McpErrorCode;

  readonly data: unknown;

  constructor(code: McpErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = 'ChannelError';
    this.code = code;
    this.data = data;
  }
}

/** 通道已断开。 */
export class ChannelDisconnectedError extends ChannelError {
  constructor(message = '与剪辑内核的通道已断开，请确认 ClipCut Web 已打开并已连接。') {
    super(McpErrorCode.CHANNEL_DISCONNECTED, message);
    this.name = 'ChannelDisconnectedError';
  }
}

/** 调用超时。 */
export class ChannelTimeoutError extends ChannelError {
  constructor(timeoutMs: number) {
    super(McpErrorCode.TIMEOUT, `调用超时（${timeoutMs}ms）。`);
    this.name = 'ChannelTimeoutError';
  }
}

/** 参数非法。 */
export class InvalidArgsError extends ChannelError {
  constructor(message: string) {
    super(McpErrorCode.INVALID_ARGS, message);
    this.name = 'InvalidArgsError';
  }
}

/** V1.0 未实现。 */
export class NotImplementedError extends ChannelError {
  constructor(tool: string) {
    super(
      McpErrorCode.NOT_IMPLEMENTED,
      `工具「${tool}」在 ClipCut Web V1.0 中为设计骨架，尚未实现（not implemented in v1.0）。`,
    );
    this.name = 'NotImplementedError';
  }
}

/** 把任意错误映射为通道错误。 */
export function toChannelError(error: unknown): ChannelError {
  if (error instanceof ChannelError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ChannelError(McpErrorCode.INTERNAL, message);
}
