/**
 * AI Provider 错误类型。
 */

/** Provider 错误基类。 */
export class ProviderError extends Error {
  /** 机器可读错误码。 */
  readonly code: string;

  constructor(message: string, code = 'PROVIDER_ERROR', options?: { cause?: unknown }) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    if (options && 'cause' in options) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Provider 未配置（缺 baseUrl / apiKey）。 */
export class ProviderNotConfiguredError extends ProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'NOT_CONFIGURED', options);
    this.name = 'ProviderNotConfiguredError';
  }
}

/** 该 Provider 尚未实现该能力。 */
export class ProviderNotImplementedError extends ProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'NOT_IMPLEMENTED', options);
    this.name = 'ProviderNotImplementedError';
  }
}

/** 调用超时。 */
export class ProviderTimeoutError extends ProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'TIMEOUT', options);
    this.name = 'ProviderTimeoutError';
  }
}
