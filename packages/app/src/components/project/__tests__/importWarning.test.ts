/**
 * FR-063⑦ · 导入告警的 UI 呈现规则。
 *
 * ## 为什么这组用例存在
 *
 * 「只呈现 `duration-recomputed`，`value-clamped` 不进 UI」是一条**强制**的 UI 规则
 * （PRD §9.10 决策一第 3 行 + FR-063⑦ §四.4）。
 *
 * 如果测试只是在测试文件里**复制**一份 filter 逻辑去断言，复制品与组件真正使用的
 * 逻辑可能不一致 —— 规则一旦被改坏，测试仍然是绿的。因此这里**直接调用组件使用的
 * 同一个纯函数**（`countPresentableWarnings`），保证「测试断言的 = 生产代码执行的」。
 */

import { describe, expect, it } from 'vitest';
import { deserialize, type DeserializeWarning } from '../../../domain/project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import { countPresentableWarnings } from '../importWarning.js';

/** 篡改夹具里的第一个 clip 的 durationMs（触发 duration-recomputed）。 */
function tamperedDuration(): { doc: unknown; warnings: DeserializeWarning[] } {
  const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
  const tracks = json['tracks'] as Array<Record<string, unknown>>;
  for (const track of tracks) {
    const clips = track['clips'] as Array<Record<string, unknown>> | undefined;
    const clip = clips?.[0];
    if (clip && clip['assetId'] !== null) {
      clip['durationMs'] = 999_999;
      break;
    }
  }
  return deserialize(json);
}

/** 篡改夹具里的第一个 clip 的 transform.scale（只触发 value-clamped）。 */
function tamperedClamp(): { doc: unknown; warnings: DeserializeWarning[] } {
  const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
  const tracks = json['tracks'] as Array<Record<string, unknown>>;
  for (const track of tracks) {
    const clips = track['clips'] as Array<Record<string, unknown>> | undefined;
    const clip = clips?.[0];
    if (clip) {
      const transform = clip['transform'] as Record<string, unknown>;
      transform['scale'] = 1000;
      break;
    }
  }
  return deserialize(json);
}

describe('FR-063⑦ · UI 只呈现 duration-recomputed', () => {
  it('value-clamped 不进 UI（计数为 0）', () => {
    const { warnings } = tamperedClamp();

    // 前置：确实产生了 value-clamped 告警（可观测）。
    expect(warnings.filter((w) => w.code === 'value-clamped').length).toBeGreaterThan(0);

    // 强制过滤规则：UI 计数为 0 → 不呈现任何 toast。
    expect(countPresentableWarnings(warnings)).toBe(0);
  });

  it('duration-recomputed 进 UI（计数为该类告警条数）', () => {
    const { warnings } = tamperedDuration();

    const recomputed = warnings.filter((w) => w.code === 'duration-recomputed');
    expect(recomputed.length).toBeGreaterThan(0);
    expect(countPresentableWarnings(warnings)).toBe(recomputed.length);
  });

  it('两类同时出现时，只统计 duration-recomputed', () => {
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const tracks = json['tracks'] as Array<Record<string, unknown>>;
    for (const track of tracks) {
      const clips = track['clips'] as Array<Record<string, unknown>> | undefined;
      const clip = clips?.[0];
      if (clip && clip['assetId'] !== null) {
        clip['durationMs'] = 999_999;
        const transform = clip['transform'] as Record<string, unknown>;
        transform['scale'] = 1000;
        break;
      }
    }
    const { warnings } = deserialize(json);

    expect(warnings.filter((w) => w.code === 'duration-recomputed').length).toBeGreaterThan(0);
    expect(warnings.filter((w) => w.code === 'value-clamped').length).toBeGreaterThan(0);

    // 计数 = duration-recomputed 的条数（**不含** value-clamped）。
    expect(countPresentableWarnings(warnings)).toBe(
      warnings.filter((w) => w.code === 'duration-recomputed').length,
    );
  });

  it('无告警 → 计数为 0（不呈现空提示）', () => {
    const { warnings } = deserialize(readFixtureJson('minimal.clipcut.json'));
    expect(warnings).toEqual([]);
    expect(countPresentableWarnings(warnings)).toBe(0);
  });
});
