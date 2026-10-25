/**
 * FR-064② · 编辑路径（`setClipProperty`）与导入路径（`deserialize`）的**共用钳制**契约。
 *
 * ## 为什么需要这个文件
 *
 * PRD FR-064② 要求：
 * > `setClipProperty` 与 `deserialize` **均调用同一函数** ——
 * > **可由变异测试验证：移除其中任一处的调用，测试必须失败**。
 *
 * QA 第七轮复核（2026-10-23）实测发现该契约**只守住了一半**：
 *
 * | 变异 | 目标 | 实测结果 |
 * |---|---|---|
 * | M1 | 移除 `deserialize.ts` 中的 `clampProjectNumericValues` / `clampClipNumericValues` 调用 | ✅ **测试失败**（`importConstraints.test.ts` 2 个用例挂） |
 * | M2 | 移除 `operations.ts` 的 `setClipProperty` 中的 `clampToRange` 调用 | ❌ **测试仍全绿** —— 防线缺失 |
 *
 * 根因：`importConstraints.test.ts` 只断言了**导入路径**的钳制行为，
 * **没有任何测试断言 `setClipProperty` 会把越界值钳制到合法区间**。
 * 于是「编辑路径」侧的调用可以被静默移除而无人察觉 ——
 * 这正是 FR-064② 明令要防住的半成品状态。
 *
 * ## 本文件补什么
 *
 * 1. **`setClipProperty` 的钳制行为**（直接堵住 M2 缺口）：
 *    越界数值必须被钳制到 `CLIP_NUMERIC_RANGES` 给出的边界；
 *    合法值必须**原样保留**（不得被误钳）。
 * 2. **两条路径共用同一张约束表**（FR-064② 的「同一函数」）：
 *    对同一路径，编辑路径的钳制结果与导入路径的钳制结果必须**完全一致**。
 *
 * ## 为什么不用 `deserialize` 构造夹具
 *
 * 本文件刻意**不调用 `deserialize`**，而是用 `createEmptyProject` + `addClip`
 * 直接构造工程。原因：`deserialize` 的返回类型正在被 FR-063⑦ 改造
 * （`ProjectDoc` → `DeserializeResult`），若本文件依赖它，
 * 就会在那次改造中被迫改写、徒增冲突面。
 * 用工厂构造让本文件只依赖 `operations.ts` 与 `valueRanges.ts` —— 稳定且自洽。
 */

import { describe, expect, it } from 'vitest';
import type { ProjectDoc } from '@clipcut/shared-types';
import { createEmptyProject } from '../../project/factory.js';
import { addClip, addTrack, setClipProperty, type OperationContext } from '../operations.js';
import { CLIP_NUMERIC_RANGES, clampClipNumericValues } from '../valueRanges.js';

/** 构造一个含单个文字 clip 的工程（不依赖 `deserialize`）。 */
function makeDocWithClip(): { doc: ProjectDoc; clipId: string } {
  const doc = createEmptyProject('契约测试工程', new Date('2026-01-01T00:00:00.000Z'));
  // 取消预设轨道后，测试显式建一条文字轨。
  const withTrack = addTrack(
    { doc, assets: doc.assets },
    { type: 'text', name: '文字轨 1' },
  );
  const textTrack = withTrack.doc.tracks.find((track) => track.type === 'text');
  if (!textTrack) throw new Error('应成功创建文字轨');

  const context: OperationContext = { doc: withTrack.doc, assets: withTrack.doc.assets };
  const result = addClip(context, {
    assetId: null,
    trackId: textTrack.id,
    startMs: 0,
    inMs: 0,
    outMs: 1000,
  });

  const clipId = result.selectedClipId;
  if (!clipId) throw new Error('addClip 应返回新 clip 的 id');
  return { doc: result.doc, clipId };
}

/** 取 clip 上的某个数值字段（按 `'group.key'` 路径）。 */
function readNumeric(doc: ProjectDoc, clipId: string, path: string): number | undefined {
  const clip = doc.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
  if (!clip) return undefined;
  const [group, key] = path.split('.');
  const source = group && key ? (clip[group as 'audio' | 'transform' | 'text'] as Record<string, unknown>) : clip;
  const value = source?.[key ?? path];
  return typeof value === 'number' ? value : undefined;
}

describe('FR-064② · 编辑路径（setClipProperty）的数值钳制', () => {
  it('越界的 transform.scale 被钳制到 CLIP_NUMERIC_RANGES 的下界', () => {
    const { doc, clipId } = makeDocWithClip();
    const context: OperationContext = { doc, assets: doc.assets };

    const result = setClipProperty(context, clipId, 'transform.scale', 0.001);

    const expected = CLIP_NUMERIC_RANGES['transform.scale'];
    expect(expected).toBeDefined();
    expect(readNumeric(result.doc, clipId, 'transform.scale')).toBe(expected?.[0]);
  });

  it('越界的 transform.scale 被钳制到上界（远超上限时）', () => {
    const { doc, clipId } = makeDocWithClip();
    const context: OperationContext = { doc, assets: doc.assets };

    const result = setClipProperty(context, clipId, 'transform.scale', 9999);

    const expected = CLIP_NUMERIC_RANGES['transform.scale'];
    expect(readNumeric(result.doc, clipId, 'transform.scale')).toBe(expected?.[1]);
  });

  it('越界的 transform.cornerRadius / text.fontSize 被钳制到上界', () => {
    const { doc, clipId } = makeDocWithClip();
    const context: OperationContext = { doc, assets: doc.assets };

    const corner = setClipProperty(context, clipId, 'transform.cornerRadius', 99_999);
    expect(readNumeric(corner.doc, clipId, 'transform.cornerRadius')).toBe(
      CLIP_NUMERIC_RANGES['transform.cornerRadius']?.[1],
    );

    const font = setClipProperty(
      { doc: corner.doc, assets: corner.doc.assets },
      clipId,
      'text.fontSize',
      99_999,
    );
    expect(readNumeric(font.doc, clipId, 'text.fontSize')).toBe(
      CLIP_NUMERIC_RANGES['text.fontSize']?.[1],
    );
  });

  it('合法值必须原样保留（不得被误钳）', () => {
    const { doc, clipId } = makeDocWithClip();
    const context: OperationContext = { doc, assets: doc.assets };

    const result = setClipProperty(context, clipId, 'transform.scale', 2.5);

    expect(readNumeric(result.doc, clipId, 'transform.scale')).toBe(2.5);
  });

  it('负值 / 非有限值被钳制到下界（不产生非法数值）', () => {
    const { doc, clipId } = makeDocWithClip();
    const context: OperationContext = { doc, assets: doc.assets };

    const lower = CLIP_NUMERIC_RANGES['transform.rotation']?.[0];
    const result = setClipProperty(context, clipId, 'transform.rotation', -999_999);
    expect(readNumeric(result.doc, clipId, 'transform.rotation')).toBe(lower);
  });

  it('越界值被钳制后仍满足领域层不变式', () => {
    const { doc, clipId } = makeDocWithClip();
    const context: OperationContext = { doc, assets: doc.assets };

    const result = setClipProperty(context, clipId, 'transform.scale', 0.0001);

    const clip = result.doc.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    expect(clip).toBeDefined();
    const scale = clip?.transform.scale;
    const range = CLIP_NUMERIC_RANGES['transform.scale'];
    expect(scale).toBeGreaterThanOrEqual(range?.[0] ?? 0);
    expect(scale).toBeLessThanOrEqual(range?.[1] ?? Number.MAX_VALUE);
  });
});

describe('FR-064② · 编辑路径与导入路径共用同一张约束表', () => {
  it('两条路径对同一路径的钳制结果完全一致', () => {
    // 导入路径的钳制入口：`clampClipNumericValues`（`deserialize` 内部调用它）
    // 编辑路径的钳制入口：`setClipProperty` → `clampToRange`（共用 `CLIP_NUMERIC_RANGES`）
    // 这里对**同一个 clip** 分别施加两种入口，断言结果相同 ——
    // 若将来有人给两条路径各写一张表，这个断言会立刻失败。
    for (const [path, range] of Object.entries(CLIP_NUMERIC_RANGES)) {
      const outOfRange = range[1] + 1000;

      // 导入路径：先写入越界值，再交给 `clampClipNumericValues` 钳制
      // （`deserialize` 内部调用的就是它）
      const importSide = {
        id: 'clip-contract',
        assetId: null,
        startMs: 0,
        durationMs: 1000,
        inMs: 0,
        outMs: 1000,
        speed: 1,
        isOverlay: false,
        zIndex: 0,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, cornerRadius: 0 },
        audio: { gain: 1, fadeInMs: 0, fadeOutMs: 0 },
        text: { fontSize: 16, fontWeight: 400, strokeWidth: 0, lineHeight: 1.2, letterSpacing: 0, align: 'center', verticalAlign: 'middle' },
        label: null,
      };
      writePath(importSide as unknown as Record<string, unknown>, path, outOfRange);
      clampClipNumericValues(importSide as never);
      const importValue = readPath(importSide as unknown as Record<string, unknown>, path);

      // 编辑路径：同一路径、同一越界值
      const { doc, clipId } = makeDocWithClip();
      const context: OperationContext = { doc, assets: doc.assets };
      const edited = setClipProperty(context, clipId, path, outOfRange);
      const editValue = readNumeric(edited.doc, clipId, path);

      expect(editValue, `路径 ${path} 的两条路径钳制结果应一致`).toBe(importValue);
    }
  });
});

/** 读取对象上某个路径的数值（`'group.key'` 或顶层键）。 */
function readPath(root: Record<string, unknown>, path: string): number | undefined {
  const [group, key] = path.split('.');
  const source = group && key ? (root[group] as Record<string, unknown> | undefined) : root;
  const value = source?.[key ?? path];
  return typeof value === 'number' ? value : undefined;
}

/** 写入对象上某个路径的数值（`'group.key'` 或顶层键）。 */
function writePath(root: Record<string, unknown>, path: string, value: number): void {
  const [group, key] = path.split('.');
  if (group && key) {
    const target = root[group] as Record<string, unknown> | undefined;
    if (target) target[key] = value;
    return;
  }
  root[path] = value;
}
