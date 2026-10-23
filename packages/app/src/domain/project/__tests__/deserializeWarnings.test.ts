/**
 * FR-063⑦ · 导入路径告警通道。
 *
 * ## 这些用例守护什么
 *
 * 1. **告警通道存在且可断言** —— `deserialize` 返回 `DeserializeResult`，
 *    告警**经返回值传递**（不是回调、不是全局事件、不是 toast）。
 * 2. **只装修正事实** —— 每次真实的数值改写对应一条告警；未发生修正 → 绝不占位。
 * 3. **容差生效** —— 1ms 及以内的差异视为取整噪声，不告警（防止将来公式微调全量刷屏）。
 * 4. **文字 clip 豁免** —— `assetId === null` 的 clip 时长独立于素材，不产生告警。
 * 5. **数据污染防线** —— `warnings` **绝不**挂到 `doc` 上（否则会被写进用户工程文件）。
 * 6. **排序确定性** —— `duration-recomputed` 在前、`value-clamped` 在后。
 */

import { describe, expect, it } from 'vitest';
import type { Clip } from '@clipcut/shared-types';
import { deserialize, deserializeFromJson } from '../deserialize.js';
import { serialize } from '../serialize.js';
import { ValidationError } from '../validation.js';
import { DURATION_RECOMPUTE_TOLERANCE_MS } from '../../timeline/invariants.js';
import { readFixtureJson } from '../../../test/fixtures.js';

/** 夹具里的工程对象（可篡改）。 */
type FixtureJson = Record<string, unknown>;

/** 取夹具里第一个 clip（可篡改）。 */
function firstClip(json: FixtureJson): Clip {
  const tracks = json['tracks'] as Array<Record<string, unknown>>;
  for (const track of tracks) {
    const clips = track['clips'] as Array<Record<string, unknown>> | undefined;
    const clip = clips?.[0];
    if (clip) return clip as unknown as Clip;
  }
  throw new Error('夹具缺少 clip');
}

/** 取夹具里的文字 clip（`assetId === null`）。 */
function textClip(json: FixtureJson): Clip {
  const tracks = json['tracks'] as Array<Record<string, unknown>>;
  const textTrack = tracks.find((track) => track['type'] === 'text');
  const clips = textTrack?.['clips'] as Array<Record<string, unknown>> | undefined;
  const clip = clips?.[0];
  if (!clip) throw new Error('夹具缺少文字 clip');
  return clip as unknown as Clip;
}

/** 在 doc 中按 id 找到 clip。 */
function findClip(doc: { tracks: Array<{ clips: Clip[] }> }, id: string): Clip | undefined {
  for (const track of doc.tracks) {
    const found = track.clips.find((clip) => clip.id === id);
    if (found) return found;
  }
  return undefined;
}

describe('FR-063⑦ · 告警通道结构', () => {
  it('deserialize 返回 DeserializeResult（单一入口，不存在裸 ProjectDoc 平行入口）', () => {
    const result = deserialize(readFixtureJson('full.clipcut.json'));

    // 结构断言：既有 doc，也有 warnings 数组。
    expect(result).toHaveProperty('doc');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.doc.projectId).toBe('c2d4e6f8-0a1b-4c3d-9e5f-7a8b9c0d1e2f');
  });

  it('deserializeFromJson 与 deserialize 返回类型完全相同（⑦-4）', () => {
    const fromJson = deserializeFromJson(JSON.stringify(readFixtureJson('minimal.clipcut.json')));
    const fromObject = deserialize(readFixtureJson('minimal.clipcut.json'));

    expect(fromJson.doc.projectId).toBe(fromObject.doc.projectId);
    expect(fromJson.warnings).toEqual(fromObject.warnings);
  });

  it('正常工程导入 → warnings 为空数组（绝不占位）', () => {
    for (const name of ['minimal.clipcut.json', 'full.clipcut.json', 'legacy-0.9.clipcut.json']) {
      const { warnings } = deserialize(readFixtureJson(name));
      expect(warnings, `${name} 不应有告警`).toEqual([]);
    }
  });

  it('⚠️ warnings 绝不进入 doc（数据污染防线，PM §四.5）', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));

    // doc 上不得有 warnings 键（连同任何嵌套位置）。
    expect('warnings' in doc).toBe(false);
    expect(Object.keys(doc)).not.toContain('warnings');
    expect(JSON.stringify(doc)).not.toContain('warnings');

    // serialize 的输出里也不得含 warnings —— 否则会被写进用户保存的工程文件。
    const output = serialize(doc);
    expect(output).not.toContain('warnings');
    expect(JSON.parse(output) as Record<string, unknown>).not.toHaveProperty('warnings');
  });

  it('⚠️ 即使工程被篡改，doc 上也不得挂载 warnings', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    firstClip(json).durationMs = 999_999;

    const { doc, warnings } = deserialize(json);
    expect(warnings.length).toBeGreaterThan(0);
    // 关键：告警存在，但 doc 上干干净净。
    expect('warnings' in doc).toBe(false);
    expect(serialize(doc)).not.toContain('warnings');
  });
});

describe('FR-063⑦ · duration-recomputed 产生规则', () => {
  it('篡改 durationMs → 产生告警，且 doc 中已重算为公式值', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const clip = firstClip(json);
    clip.durationMs = 999_999;

    const { doc, warnings } = deserialize(json);

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.code).toBe('duration-recomputed');

    const warning = warnings[0];
    expect(warning?.clipId).toBe(clip.id);
    expect(warning?.field).toBe('durationMs');
    expect(warning?.expected).toBe(Math.round((clip.outMs - clip.inMs) / clip.speed));
    expect(warning?.actual).toBe(999_999);

    // doc 里的值已被重算。
    const restored = findClip(doc, clip.id);
    expect(restored?.durationMs).toBe(Math.round((clip.outMs - clip.inMs) / clip.speed));
    expect(restored?.durationMs).not.toBe(999_999);
  });

  it('文字 clip（assetId === null）→ 不产生 duration-recomputed', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const clip = textClip(json);
    expect(clip.assetId).toBeNull();
    clip.durationMs = 4321;

    const { doc, warnings } = deserialize(json);

    // 文字 clip 的时长独立于素材 → 既不重算，也不告警。
    expect(warnings.filter((w) => w.clipId === clip.id)).toEqual([]);
    expect(findClip(doc, clip.id)?.durationMs).toBe(4321);
  });

  it('容差边界：差 1ms 不告警，差 2ms 告警（1ms 及以内视为取整噪声）', () => {
    const base = readFixtureJson('full.clipcut.json') as FixtureJson;
    const probe = firstClip(base);
    const expected = Math.round((probe.outMs - probe.inMs) / probe.speed);

    // 恰好差 1ms（= 容差）→ 不告警。
    const withinJson = readFixtureJson('full.clipcut.json') as FixtureJson;
    const withinClip = firstClip(withinJson);
    withinClip.durationMs = expected + DURATION_RECOMPUTE_TOLERANCE_MS;
    const within = deserialize(withinJson);
    expect(within.warnings.filter((w) => w.code === 'duration-recomputed')).toEqual([]);

    // 差 2ms（> 容差）→ 告警。
    const beyondJson = readFixtureJson('full.clipcut.json') as FixtureJson;
    const beyondClip = firstClip(beyondJson);
    beyondClip.durationMs = expected + DURATION_RECOMPUTE_TOLERANCE_MS + 1;
    const beyond = deserialize(beyondJson);
    const beyondWarnings = beyond.warnings.filter((w) => w.code === 'duration-recomputed');
    expect(beyondWarnings.length).toBeGreaterThan(0);
    expect(beyondWarnings[0]?.actual).toBe(expected + DURATION_RECOMPUTE_TOLERANCE_MS + 1);
    expect(beyondWarnings[0]?.expected).toBe(expected);
  });

  it('容差常量恒为 1ms', () => {
    expect(DURATION_RECOMPUTE_TOLERANCE_MS).toBe(1);
  });

  it('meta.durationMs 也按同一套规则告警（工程级派生量，clipId 为 undefined）', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const meta = json['meta'] as Record<string, unknown>;
    meta['durationMs'] = 999_999;

    const { warnings } = deserialize(json);
    const metaWarning = warnings.find((w) => w.field === 'meta.durationMs');

    expect(metaWarning).toBeDefined();
    expect(metaWarning?.code).toBe('duration-recomputed');
    expect(metaWarning?.clipId).toBeUndefined();
    expect(metaWarning?.actual).toBe(999_999);
    expect(metaWarning?.expected).toBe(30_000);
  });
});

describe('FR-063⑦ · value-clamped 产生规则', () => {
  it('篡改 transform.scale / rotation / cornerRadius → 产生 value-clamped 且值已钳制', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const clip = firstClip(json);
    clip.transform.scale = 1000;
    clip.transform.rotation = 1e9;
    clip.transform.cornerRadius = 99_999;

    const { doc, warnings } = deserialize(json);
    const clamped = warnings.filter((w) => w.code === 'value-clamped');
    expect(clamped.length).toBe(3);

    const byField = new Map(clamped.map((w) => [w.field, w]));
    expect(byField.get('transform.scale')?.actual).toBe(1000);
    expect(byField.get('transform.scale')?.expected).toBe(20);
    expect(byField.get('transform.rotation')?.expected).toBe(3600);
    expect(byField.get('transform.cornerRadius')?.expected).toBe(1000);
    expect(byField.get('transform.scale')?.clipId).toBe(clip.id);

    // 值确实已被钳制。
    const restored = findClip(doc, clip.id);
    expect(restored?.transform.scale).toBe(20);
    expect(restored?.transform.rotation).toBe(3600);
    expect(restored?.transform.cornerRadius).toBe(1000);
  });

  it('篡改 text.lineHeight → 产生 value-clamped 且值已钳制', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const clip = textClip(json);
    clip.text!.lineHeight = 999;

    const { doc, warnings } = deserialize(json);
    const clamped = warnings.find((w) => w.field === 'text.lineHeight');

    expect(clamped).toBeDefined();
    expect(clamped?.code).toBe('value-clamped');
    expect(clamped?.actual).toBe(999);
    expect(clamped?.expected).toBe(10);
    expect(clamped?.clipId).toBe(clip.id);
    expect(findClip(doc, clip.id)?.text?.lineHeight).toBe(10);
  });

  it('值在区间内 → 不产生 value-clamped（绝不占位）', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const clip = firstClip(json);
    clip.transform.scale = 2; // 合法区间内
    clip.transform.rotation = 90; // 合法区间内

    const { warnings } = deserialize(json);
    expect(warnings.filter((w) => w.code === 'value-clamped')).toEqual([]);
  });

  it('⚠️ value-clamped 不进 UI（UI 层过滤规则的断言）', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    firstClip(json).transform.scale = 1000;

    const { warnings } = deserialize(json);

    // UI 侧的强制过滤规则：只统计 `duration-recomputed`。
    const shownCount = warnings.filter((w) => w.code === 'duration-recomputed').length;

    // 存在 value-clamped 告警（可观测），但 UI 计数为 0（不呈现）。
    expect(warnings.filter((w) => w.code === 'value-clamped').length).toBeGreaterThan(0);
    expect(shownCount).toBe(0);
  });
});

describe('FR-063⑦ · 排序确定性', () => {
  it('duration-recomputed 排在 value-clamped 之前', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const clip = firstClip(json);
    // 同时触发两类告警。
    clip.durationMs = 999_999;
    clip.transform.scale = 1000;

    const { warnings } = deserialize(json);

    expect(warnings.length).toBeGreaterThan(1);
    expect(warnings[0]?.code).toBe('duration-recomputed');

    // 全部 duration-recomputed 在前，全部 value-clamped 在后。
    const firstClamped = warnings.findIndex((w) => w.code === 'value-clamped');
    const lastRecomputed = warnings.map((w) => w.code).lastIndexOf('duration-recomputed');
    expect(lastRecomputed).toBeLessThan(firstClamped);
  });

  it('同一输入多次反序列化 → warnings 顺序完全一致（确定性）', () => {
    const build = (): FixtureJson => {
      const json = readFixtureJson('full.clipcut.json') as FixtureJson;
      const clip = firstClip(json);
      clip.durationMs = 999_999;
      clip.transform.scale = 1000;
      clip.transform.rotation = 1e9;
      return json;
    };

    const first = deserialize(build()).warnings;
    const second = deserialize(build()).warnings;

    expect(second).toEqual(first);
    expect(first.map((w) => `${w.code}:${w.field}`)).toEqual(
      second.map((w) => `${w.code}:${w.field}`),
    );
  });

  it('组内按 track 顺序 → clip 顺序排列', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const tracks = json['tracks'] as Array<Record<string, unknown>>;
    // 篡改多个轨道的多个 clip 的 durationMs。
    for (const track of tracks) {
      const clips = track['clips'] as Array<Record<string, unknown>> | undefined;
      for (const clip of clips ?? []) {
        if (clip['assetId'] !== null) clip['durationMs'] = 999_999;
      }
    }

    const { warnings } = deserialize(json);
    const recomputed = warnings.filter((w) => w.code === 'duration-recomputed');

    expect(recomputed.length).toBeGreaterThan(1);

    // 按 (track 顺序, clip 顺序) 单调递增。
    const positions = recomputed.map((w) => {
      const trackIndex = tracks.findIndex((track) =>
        (track['clips'] as Array<Record<string, unknown>> | undefined)?.some(
          (clip) => clip['id'] === w.clipId,
        ),
      );
      const clipIndex = (
        (tracks[trackIndex]?.['clips'] as Array<Record<string, unknown>> | undefined) ?? []
      ).findIndex((clip) => clip['id'] === w.clipId);
      return trackIndex * 1000 + clipIndex;
    });

    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });
});

describe('FR-063⑦ · 既有行为不得回归', () => {
  it('outMs <= inMs（源区间倒置）仍然显式拒绝抛错', () => {
    const json = readFixtureJson('full.clipcut.json') as FixtureJson;
    const clip = firstClip(json);
    clip.inMs = 5000;
    clip.outMs = 100;

    // 不返回 DeserializeResult —— 直接抛错。
    expect(() => deserialize(json)).toThrowError(ValidationError);
  });

  it('deserialize 保持纯函数（不产生副作用）', () => {
    // 连续两次反序列化同一份 JSON → 结果一致（无内部状态、无副作用）。
    const json = readFixtureJson('full.clipcut.json');
    const first = deserialize(json);
    const second = deserialize(json);

    expect(second.doc.meta.durationMs).toBe(first.doc.meta.durationMs);
    expect(second.warnings).toEqual(first.warnings);
  });
});
