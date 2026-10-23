/**
 * 通用类型：跨包共享的基础抽象。
 *
 * 本文件不含任何运行时逻辑，只提供类型。
 */

/** 成功/失败二值结果，避免在领域层大量抛异常。 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

/** 可释放资源的对象。 */
export interface Disposable {
  dispose(): void | Promise<void>;
}

/** 深度只读类型。 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** 深度可变类型（`DeepReadonly` 的逆操作）。 */
export type Mutable<T> = T extends (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

/** 只允许写入指定键的类型。 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** 时间常量。 */
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** 通用时间线常量。 */
export const MIN_CLIP_DURATION_MS = 100;
export const DEFAULT_FPS = 30;
export const REFERENCE_CANVAS_HEIGHT = 1080;
export const REFERENCE_CANVAS_WIDTH = 1920;

/** 限流/防抖的默认时长（毫秒）。 */
export const DEFAULT_SEARCH_DEBOUNCE_MS = 200;
export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 3000;

/** 判断是否为「非空字符串」。 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 构造一个成功结果。 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** 构造一个失败结果。 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
