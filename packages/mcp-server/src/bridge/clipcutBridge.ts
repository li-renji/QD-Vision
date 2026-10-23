/**
 * `ClipCutBridge`：把 15 个工具调用转发到 WebSocket 通道，映射错误码。
 */

import {
  McpErrorCode,
  type McpChannelMessage,
  type McpEventTopic,
} from '@clipcut/shared-types';
import { ChannelDisconnectedError, ChannelError } from './errors.js';
import { callWithTimeout, DEFAULT_CALL_TIMEOUT_MS, encodeMessage } from '../channel/codec.js';

/** 桥接口。 */
export interface ClipCutBridge {
  /** 调用一个工具。 */
  call<TReq, TRes>(tool: string, args: TReq, timeoutMs?: number): Promise<TRes>;
  /** 订阅进度事件；返回取消订阅函数。 */
  onProgress(cb: (topic: string, payload: unknown) => void): () => void;
  /** 通道是否已连接。 */
  isConnected(): boolean;
}

/** 桥配置。 */
export interface ClipCutBridgeOptions {
  /** 发送消息（由 WebSocket host 注入）。 */
  send: (message: McpChannelMessage) => boolean;
  /** 是否已连接。 */
  isConnected: () => boolean;
  /** 日志。 */
  logger?: (message: string) => void;
}

/**
 * WebSocket 通道桥实现。
 */
export class WebSocketClipCutBridge implements ClipCutBridge {
  private readonly options: ClipCutBridgeOptions;

  /** 等待中的请求：id → resolve/reject。 */
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();

  /** 事件订阅者。 */
  private readonly listeners = new Set<(topic: string, payload: unknown) => void>();

  private nextId = 1;

  constructor(options: ClipCutBridgeOptions) {
    this.options = options;
  }

  isConnected(): boolean {
    return this.options.isConnected();
  }

  async call<TReq, TRes>(tool: string, args: TReq, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<TRes> {
    if (!this.isConnected()) {
      throw new ChannelDisconnectedError();
    }

    const id = `call_${this.nextId}`;
    this.nextId += 1;

    return callWithTimeout<TRes>(
      (signal) =>
        new Promise<TRes>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new ChannelError(McpErrorCode.TIMEOUT, `工具「${tool}」调用超时。`));
          }, timeoutMs);

          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            this.pending.delete(id);
          });

          this.pending.set(id, {
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value as TRes);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });

          const sent = this.options.send({ type: 'tool.call', id, tool, args });
          if (!sent) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(new ChannelDisconnectedError('消息发送失败，通道可能已关闭。'));
          }
        }),
      { timeoutMs },
    );
  }

  onProgress(cb: (topic: string, payload: unknown) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * 处理来自通道的消息。
   */
  handleMessage(message: McpChannelMessage): void {
    if (message.type === 'tool.result') {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.result);
      } else {
        waiter.reject(
          new ChannelError(message.error.code, message.error.message, message.error.data),
        );
      }
      return;
    }

    if (message.type === 'event') {
      const topic: McpEventTopic = message.topic;
      for (const listener of this.listeners) {
        listener(topic, message.payload);
      }
    }
  }

  /** 通道断开时清理所有等待中的请求。 */
  handleDisconnect(): void {
    for (const waiter of this.pending.values()) {
      waiter.reject(new ChannelDisconnectedError());
    }
    this.pending.clear();
  }
}

/**
 * 不带通道的桥（用于测试与「未连接」场景）。
 */
export class UnconnectedClipCutBridge implements ClipCutBridge {
  async call<TReq, TRes>(_tool: string, _args: TReq, _timeoutMs?: number): Promise<TRes> {
    throw new ChannelDisconnectedError();
  }

  onProgress(_cb: (topic: string, payload: unknown) => void): () => void {
    return () => {
      /* 无订阅者 */
    };
  }

  isConnected(): boolean {
    return false;
  }
}

/** 便于测试的通道消息编码。 */
export { encodeMessage };
