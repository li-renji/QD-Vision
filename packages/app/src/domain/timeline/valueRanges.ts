/**
 * 领域层数值范围约束（FR-064）。
 *
 * ## 为什么要有这个模块
 *
 * 早期实现把数值范围表（`NUMERIC_RANGES`）直接挂在 `setClipProperty` 上，
 * 结果**领域层的数值约束对「导入路径」整体失效**：
 * `deserialize` 走的是另一条路（`fillMissing`），完全不经过这张表。
 * 于是篡改 `.clipcut.json` 里的 `transform.scale` / `rotation` / `cornerRadius` /
 * `lineHeight` 全部能导入通过，造成视觉破坏（片段消失、画布全黑、文字重叠）。
 *
 * 本模块把范围表与钳制逻辑抽成**单一真源**，由两条路径共同使用：
 * 1. `setClipProperty` —— 用户在 UI 里改属性；
 * 2. `deserialize` —— 导入外部 / 第三方分享的工程文件。
 *
 * 将来新增受约束字段时，**只需在下面的表里加一行**，两条路径自动同时生效。
 *
 * ## 钳制「改了什么」如何被感知（FR-063⑦）
 *
 * 钳制本身是**静默的就地修改**（编辑路径不该打扰用户），但导入路径需要把
 * 「系统替我改了什么」**如实记录**下来（`value-clamped` 告警）。
 *
 * 因此钳制函数接受一个**可选**的收集参数（`ClampOptions.changes`）：
 * - **不传** → 行为与改造前完全一致（`setClipProperty` 等调用点零改动）；
 * - **传了** → 每次「值确实被改变」时追加一条 `ClampChange`。
 *
 * 这样既不破坏既有调用方式，又让 `deserialize` 能产出可断言的告警数据。
 */

import type { Clip, ProjectDoc } from '@clipcut/shared-types';

/** 数值范围：��下界, 上界]。 */
export type NumericRange = [number, number];

/**
 * clip 级数值约束（12 条路径）。
 *
 * 与 Schema 互补：Schema 能表达单字段边界，但**跨字段约束**（如 durationMs 与
 * in/out/speed 的关系）必须在领域层做。
 */
export const CLIP_NUMERIC_RANGES: Readonly<Record<string, NumericRange>> = {
  'audio.gain': [0, 2],
  'audio.fadeInMs': [0, Number.MAX_SAFE_INTEGER],
  'audio.fadeOutMs': [0, Number.MAX_SAFE_INTEGER],
  'transform.x': [0, 1],
  'transform.y': [0, 1],
  'transform.scale': [0.01, 20],
  'transform.rotation': [-3600, 3600],
  'transform.opacity': [0, 1],
  'transform.cornerRadius': [0, 1000],
  'text.fontSize': [1, 2000],
  'text.fontWeight': [100, 900],
  'text.strokeWidth': [0, 100],
  'text.lineHeight': [0.1, 10],
  'text.letterSpacing': [-100, 100],
  'zIndex': [0, 1000],
};

/**
 * 工程级数值约束（画布 / 导出 / 轨道）。
 *
 * `export.fps` 的下限 10 是 **D-003 的关键约束**：
 * 低于 10fps 时，短于 100ms 的片段会在导出离散采样时被整段丢弃（静默数据丢失）。
 *
 * 下面按「作用对象」分组，便于对子对象直接施加钳制；
 * `PROJECT_NUMERIC_RANGES` 是它们的**工程路径视角**汇总（供文档与测试使用）。
 */
export const CANVAS_NUMERIC_RANGES: Readonly<Record<string, NumericRange>> = {
  width: [1, 7680],
  height: [1, 4320],
  fps: [10, 240],
};

export const EXPORT_NUMERIC_RANGES: Readonly<Record<string, NumericRange>> = {
  width: [1, 7680],
  height: [1, 4320],
  fps: [10, 60],
};

export const TRACK_NUMERIC_RANGES: Readonly<Record<string, NumericRange>> = {
  height: [1, 200],
};


/**
 * 一次钳制实际改变某处数值的事实（FR-063⑦）。
 *
 * 与 `DeserializeWarning` 同构：`deserialize` 负责把 `ClampChange` 映射为
 * `value-clamped` 告警，并补上 `clipId`。
 */
export interface ClampChange {
  /** 受影响的字段路径，如 `'transform.scale'` / `'settings.canvas.width'`。 */
  path: string;
  /** 钳制前的原值。 */
  actual: number;
  /** 钳制后采用的值。 */
  expected: number;
}

/**
 * 钳制的**可选**参数（FR-063⑦）。
 *
 * 全部字段可省略 —— 省略时行为与改造前完全一致（既有调用点零改动）。
 */
export interface ClampOptions {
  /** 收集「被改动的数值」；不传 → 完全静默（既有行为）。 */
  changes?: ClampChange[] | undefined;
  /** 字段路径前缀（工程级钳制用，如 `'settings.canvas.'`）。 */
  pathPrefix?: string | undefined;
}

/** 可按路径读写的对象。 */
type PathTarget = Record<string, unknown>;

/** 读取路径上的数值（不存在或非数值时返回 undefined）。 */
function readPath(root: PathTarget, path: string): number | undefined {
  const [group, key] = path.split('.');
  if (!group || !key) {
    const value = root[path];
    return typeof value === 'number' ? value : undefined;
  }
  const groupValue = root[group];
  if (!groupValue || typeof groupValue !== 'object') return undefined;
  const value = (groupValue as PathTarget)[key];
  return typeof value === 'number' ? value : undefined;
}

/** 写入路径上的数值。 */
function writePath(root: PathTarget, path: string, value: number): void {
  const [group, key] = path.split('.');
  if (!group || !key) {
    root[path] = value;
    return;
  }
  const groupValue = root[group];
  if (!groupValue || typeof groupValue !== 'object') return;
  (groupValue as PathTarget)[key] = value;
}

/**
 * 数值钳制。
 */
export function clampNumber(value: number, range: NumericRange): number {
  if (!Number.isFinite(value)) return range[0];
  return Math.min(range[1], Math.max(range[0], value));
}

/**
 * 按**clip 级**路径钳制单个数值。
 *
 * 路径不在约束表内时**原样返回**（由调用方决定是否拒绝）。
 *
 * ⚠️ 只覆盖 clip 级路径（`audio.*` / `transform.*` / `text.*` / `zIndex`）。
 * 工程级（canvas / export / track）由各自的分组表 + `clampNumericValues` 负责 ——
 * 因为 `width` / `height` / `fps` 在 canvas 与 export 下**同名但作用域不同**，
 * 放进同一张表会产生歧义。
 */
export function clampToRange(path: string, value: number): number {
  const range = CLIP_NUMERIC_RANGES[path];
  if (!range) return value;
  return clampNumber(value, range);
}

/**
 * 把对象上所有受约束的数值属性**就地**钳制到合法区间。
 *
 * 静默处理（与 `setClipProperty` 的既有行为一致）：用户导入一个正常工程
 * （可能来自旧版本或其他工具，数值略有偏差）时不应看到一堆警告。
 *
 * @param root 被钳制的对象（原地修改）
 * @param ranges 约束表
 * @param options 可选：收集「改了什么」（FR-063⑦）+ 字段路径前缀
 */
export function clampNumericValues(
  root: PathTarget,
  ranges: Readonly<Record<string, NumericRange>>,
  options?: ClampOptions,
): void {
  const prefix = options?.pathPrefix ?? '';
  for (const [path, range] of Object.entries(ranges)) {
    const current = readPath(root, path);
    if (current === undefined) continue;
    const clamped = clampNumber(current, range);
    writePath(root, path, clamped);
    // 只有「值确实被改变」才算一次修正 —— 值在区间内不记录（绝不占位）。
    if (clamped === current) continue;
    options?.changes?.push({ path: `${prefix}${path}`, actual: current, expected: clamped });
  }
}

/**
 * 钳制 clip 上的全部受约束数值（15 条路径）。
 *
 * 原地修改传入的 clip。
 *
 * @param clip 被钳制的 clip（原地修改）
 * @param options 可选：收集「改了什么」（FR-063⑦）
 */
export function clampClipNumericValues(clip: Clip, options?: ClampOptions): void {
  clampNumericValues(clip as unknown as PathTarget, CLIP_NUMERIC_RANGES, options);
}

/**
 * 钳制工程级的画布 / 导出 / 轨道参数。
 *
 * 原地修改传入的工程。
 *
 * @param doc 被钳制的工程（原地修改）
 * @param options 可选：收集「改了什么」（FR-063⑦）
 */
export function clampProjectNumericValues(doc: ProjectDoc, options?: ClampOptions): void {
  const changes = options?.changes;
  clampNumericValues(doc.settings.canvas as unknown as PathTarget, CANVAS_NUMERIC_RANGES, {
    changes,
    pathPrefix: 'settings.canvas.',
  });
  clampNumericValues(doc.settings.export as unknown as PathTarget, EXPORT_NUMERIC_RANGES, {
    changes,
    pathPrefix: 'settings.export.',
  });
  for (const track of doc.tracks) {
    clampNumericValues(track as unknown as PathTarget, TRACK_NUMERIC_RANGES, {
      changes,
      pathPrefix: 'track.',
    });
  }
}
