/**
 * 平台抽象层错误类型。
 *
 * 业务层只捕获这些错误，不直接处理底层 DOM 异常。
 */

/** 平台层错误基类。 */
export class PlatformError extends Error {
  /** 机器可读的错误码 */
  readonly code: string;

  constructor(message: string, code = 'PLATFORM_ERROR', options?: { cause?: unknown }) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    if (options && 'cause' in options) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** 当前平台不支持该操作（例如没有 File System Access API 时调用 `listFiles`）。 */
export class UnsupportedOperationError extends PlatformError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'UNSUPPORTED_OPERATION', options);
    this.name = 'UnsupportedOperationError';
  }
}

/** 用户拒绝了权限或取消了选择。 */
export class PermissionDeniedError extends PlatformError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'PERMISSION_DENIED', options);
    this.name = 'PermissionDeniedError';
  }
}
