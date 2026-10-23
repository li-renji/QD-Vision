/**
 * 不变式守卫（ARCHITECTURE §5.2 / PRD §4.1）。
 *
 * ## 唯一硬不变式
 *
 * ```ts
 * durationMs === Math.round((outMs - inMs) / speed)   // 对 assetId !== null 的 clip
 * ```
 *
 * ## 一致性契约（重要）
 *
 * `fixClipDuration()` 与 `assertClipInvariants()` **必须使用同一个公式**，
 * 否则 fix 产出的数据会被自己的 assert 判为「违反不变式」。
 * 二者都通过 `expectedDurationMs()` 这一个函数取期望值，从根本上杜绝定义漂移。
 *
 * ## 「最小时长」放在哪里管？
 *
 * `durationMs ≥ MIN_CLIP_DURATION_MS`（FR-017②）是**操作入口的准入条件**，
 * 不是不变式的一部分。因此：
 * - `fixClipDuration()` **不做任何钳制**，忠实按公式重算；
 * - 操作层（`trimClip` / `addClip` / `splitClip` / `setClipSpeed`）负责保证
 *   源区间跨度足够大 —— 用 `minSourceSpanMs(speed)` 换算。
 *
 * 早期实现把最小时长钳制写在 `fixClipDuration` 里，导致 `setClipSpeed(clip, 10)`
 * 作用于 500ms 源区间时产出 `durationMs=100`，而公式期望 50 —— 两者自相矛盾，
 * 会把不一致数据写进 `.clipcut.json`，渲染时产生 50ms 错位（超出 FR-039② 的 ≤40ms 口径）。
 */

import type { Asset, Clip } from '@clipcut/shared-types';

/** 最小 clip 时长（毫秒）—— 时间线时长口径。 */
export const MIN_CLIP_DURATION_MS = 100;

/**
 * 时长重算告警的容差（毫秒）—— FR-063⑦。
 *
 * `|expected − actual| <= DURATION_RECOMPUTE_TOLERANCE_MS` 的差异视为**取整噪声**，
 * 不产生 `duration-recomputed` 告警。
 *
 * ## 为什么需要容差
 *
 * 将来若时长公式微调（如 `round` 改 `floor`），全量工程文件都会出现 1ms 级偏差。
 * 若无容差，导入一个正常工程就会弹出一堆警告 —— 正是 PRD §9.0.1 准则二禁止的形态。
 * 容差是「不骚扰」在数据层的最后一道闸。
 */
export const DURATION_RECOMPUTE_TOLERANCE_MS = 1;

/** 变速下界。 */
export const MIN_CLIP_SPEED = 0.1;

/** 变速上界。 */
export const MAX_CLIP_SPEED = 10;

/** 不变式被破坏。 */
export class ClipInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipInvariantError';
  }
}

/**
 * 唯一的不变式公式。
 *
 * `fixClipDuration` 与 `assertClipInvariants` **必须**共用本函数。
 */
export function expectedDurationMs(clip: Pick<Clip, 'assetId' | 'inMs' | 'outMs' | 'speed'>): number {
  return Math.round((clip.outMs - clip.inMs) / clip.speed);
}

/**
 * 给定速度下，**源区间**必须覆盖的最小跨度（毫秒）。
 *
 * 由 `span / speed ≥ MIN_CLIP_DURATION_MS` 反解得到，因此变速后仍能保证最小时长。
 */
export function minSourceSpanMs(speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.ceil(MIN_CLIP_DURATION_MS * safeSpeed);
}

/**
 * 源区间是否满足「时间线时长 ≥ 最小时长」。
 */
export function isSpanLongEnough(inMs: number, outMs: number, speed: number): boolean {
  return outMs - inMs >= minSourceSpanMs(speed);
}

/**
 * 依据 `inMs` / `outMs` / `speed` **忠实按公式**重算 `durationMs`。
 *
 * ⚠️ 不做任何钳制 —— 钳制是操作层的准入责任（见文件头注释）。
 * 文字 clip（`assetId === null`）的时长独立于素材，保持原值。
 */
export function fixClipDuration(clip: Clip): Clip {
  if (clip.assetId === null) return clip;
  return { ...clip, durationMs: expectedDurationMs(clip) };
}

/**
 * 校验 clip 不变式。
 *
 * @param clip 待校验的 clip
 * @param asset 对应素材（提供时校验源区间越界）
 * @throws ClipInvariantError 不变式被破坏
 */
export function assertClipInvariants(clip: Clip, asset?: Asset): void {
  // 图片素材没有固有时长（durationMs = 0），其源区间由时间线决定，不做越界校验。
  if (clip.assetId !== null && asset && asset.type !== 'image') {
    if (clip.inMs < 0 || clip.outMs > asset.durationMs) {
      throw new ClipInvariantError(
        `素材越界：clip ${clip.id} 的源区间 [${clip.inMs}, ${clip.outMs}] 超出素材时长 ${asset.durationMs}`,
      );
    }
  }
  if (clip.durationMs < MIN_CLIP_DURATION_MS) {
    throw new ClipInvariantError(`小于最小 clip 时长：${clip.durationMs} < ${MIN_CLIP_DURATION_MS}`);
  }
  if (clip.assetId !== null) {
    const expected = expectedDurationMs(clip);
    if (clip.durationMs !== expected) {
      throw new ClipInvariantError(
        `durationMs 与 (outMs - inMs) / speed 不一致：${clip.durationMs} !== ${expected}`,
      );
    }
  }
}

/**
 * 校验一组 clip 的不变式。
 */
export function assertAllClipInvariants(clips: readonly Clip[], assets: Record<string, Asset>): void {
  for (const clip of clips) {
    const asset = clip.assetId ? assets[clip.assetId] : undefined;
    assertClipInvariants(clip, asset);
  }
}

/**
 * 一致性回归守护：`fix` 之后的 clip **必然**通过 `assert`。
 *
 * 这条断言是 fix / assert 两条定义不漂移的「契约测试」——
 * 只要有人再把钳制写回 `fixClipDuration`，本函数就会失败。
 */
export function assertFixSatisfiesAssert(clip: Clip, asset?: Asset): void {
  assertClipInvariants(fixClipDuration(clip), asset);
}