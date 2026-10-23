/**
 * Ajv 校验封装。
 *
 * JSON Schema 是**唯一真源**（`schema/project.schema.json`），
 * 运行时反序列化校验与 CI 夹具校验复用同一份定义，避免两套定义漂移。
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { ProjectDoc } from '@clipcut/shared-types';
import projectSchema from '../../../../../schema/project.schema.json';

/** 结构化校验问题。 */
export interface ValidationIssue {
  /** JSON Pointer 路径，如 `/tracks/0/clips/1` */
  path: string;
  /** Ajv 原始信息 */
  message: string;
  /** 中文提示 */
  hint: string;
}

/** 校验失败时抛出的错误。 */
export class ValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`工程数据校验失败（${issues.length} 项问题）：${issues[0]?.hint ?? ''}`);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/** Ajv 实例（draft 2020-12，`allErrors: true`，收集全部问题）。 */
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  useDefaults: false,
});

/** 编译后的校验函数。 */
const validate: ValidateFunction = ajv.compile(projectSchema as unknown as object);

/** 把 Ajv 的错误路径转换为 JSON Pointer。 */
function toPointer(error: ErrorObject): string {
  const path = error.instancePath ?? '';
  if (error.keyword === 'required' && typeof error.params?.missingProperty === 'string') {
    return `${path}/${error.params.missingProperty}`;
  }
  return path;
}

/**
 * 为 Ajv 错误生成中文提示。
 *
 * ## Ajv v8 的 `params` 参数名（易踩坑）
 *
 * Ajv v8（实测 8.20.0）的数值类错误 `params` 结构为：
 *
 * ```json
 * { "keyword": "minimum", "params": { "comparison": ">=", "limit": 10 } }
 * ```
 *
 * - `params.comparison` 是**操作符**（`">="` / `"<="` / `">"` / `"<"`）；
 * - `params.limit` 才是**约束数值**（`10`）。
 *
 * 展示给用户的必须是 `limit`；误用 `comparison` 会输出「不能小于 >=」这种
 * 既方向含混、又没有阈值的信息。
 *
 * 方向约定：`minimum` 表示「不得小于该值」，`maximum` 表示「不得大于该值」，
 * `exclusiveMinimum` 表示「必须严格大于」，`exclusiveMaximum` 表示「必须严格小于」。
 */
function toHint(error: ErrorObject): string {
  const pointer = toPointer(error);
  const location = pointer ? `字段 ${pointer}` : '根节点';
  switch (error.keyword) {
    case 'required':
      return `${location} 缺少必填字段`;
    case 'type':
      return `${location} 类型应为 ${String(error.params?.type)}`;
    case 'minimum':
      return `${location} 不能小于 ${String(error.params?.limit)}`;
    case 'maximum':
      return `${location} 不能大于 ${String(error.params?.limit)}`;
    case 'exclusiveMinimum':
      return `${location} 必须大于 ${String(error.params?.limit)}`;
    case 'exclusiveMaximum':
      return `${location} 必须小于 ${String(error.params?.limit)}`;
    case 'pattern':
      return `${location} 格式不合法`;
    case 'enum':
      return `${location} 取值不在允许范围内`;
    case 'minItems':
      return `${location} 至少需要 ${String(error.params?.limit)} 个元素`;
    default:
      return `${location} 不合法：${error.message ?? '未知错误'}`;
  }
}

/**
 * 校验工程数据。
 *
 * @returns 结构化问题列表；通过校验时返回空数组。
 */
export function validateProjectDoc(json: unknown): ValidationIssue[] {
  if (validate(json)) return [];
  const errors = validate.errors ?? [];
  return errors.map((error) => ({
    path: toPointer(error),
    message: error.message ?? 'invalid',
    hint: toHint(error),
  }));
}

/** 校验并抛出 `ValidationError`。 */
export function assertValidProjectDoc(json: unknown): asserts json is ProjectDoc {
  const issues = validateProjectDoc(json);
  if (issues.length > 0) throw new ValidationError(issues);
}

/** 把问题列表格式化为可读文本。 */
export function formatValidationErrors(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return '';
  return issues.map((issue, index) => `${index + 1}. ${issue.hint}`).join('\n');
}
