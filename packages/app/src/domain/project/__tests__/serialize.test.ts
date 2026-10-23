/**
 * 工程序列化往返一致性测试（FR-001①）。
 *
 * 验收：**保存 → 加载 → 再保存，`JSON.stringify` 结果逐字节一致**。
 */

import { describe, expect, it } from 'vitest';
import { deserialize } from '../deserialize.js';
import { serialize, serializeToObject } from '../serialize.js';
import { FIXTURE_NAMES, readFixtureJson, readFixtureText } from '../../../test/fixtures.js';

describe('domain/project/serialize', () => {
  it('保存 → 加载 → 再保存逐字节一致', () => {
    for (const name of FIXTURE_NAMES) {
      const first = serialize(deserialize(readFixtureJson(name)));
      const second = serialize(deserialize(JSON.parse(first) as unknown));
      expect(second, `夹具 ${name} 往返不一致`).toBe(first);
    }
  });

  it('夹具的键序即为规范化顺序（反序列化不改变键序）', () => {
    const canonical = [
      'schemaVersion',
      'projectId',
      'name',
      'createdAt',
      'updatedAt',
      'generator',
      'settings',
      'assets',
      'tracks',
      'subtitles',
      'meta',
    ];

    for (const name of FIXTURE_NAMES) {
      const text = readFixtureText(name);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const doc = deserialize(parsed);
      const output = serializeToObject(doc);

      const outputKeys = Object.keys(output);
      expect(outputKeys.slice(0, canonical.length), `夹具 ${name} 键序不规范`).toEqual(canonical);
      // 未知字段排在已知字段之后，且保持原有相对顺序
      const extra = Object.keys(parsed).filter((key) => !canonical.includes(key));
      expect(outputKeys.slice(canonical.length)).toEqual(extra);
    }
  });

  it('时间字段统一为毫秒整数', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        expect(Number.isInteger(clip.startMs)).toBe(true);
        expect(Number.isInteger(clip.durationMs)).toBe(true);
        expect(Number.isInteger(clip.inMs)).toBe(true);
        expect(Number.isInteger(clip.outMs)).toBe(true);
      }
    }
    for (const cue of doc.subtitles.cues) {
      expect(Number.isInteger(cue.startMs)).toBe(true);
      expect(Number.isInteger(cue.endMs)).toBe(true);
    }
  });

  it('派生量 meta.durationMs 始终为重算后的值', () => {
    const doc = deserialize(readFixtureJson('full.clipcut.json'));
    expect(doc.meta.durationMs).toBe(30_000);
    expect(serializeToObject(doc)['meta']).toMatchObject({ durationMs: 30_000 });
  });

  it('序列化结果的键序稳定', () => {
    const doc = deserialize(readFixtureJson('minimal.clipcut.json'));
    const keys = Object.keys(serializeToObject(doc));
    expect(keys).toEqual([
      'schemaVersion',
      'projectId',
      'name',
      'createdAt',
      'updatedAt',
      'generator',
      'settings',
      'assets',
      'tracks',
      'subtitles',
      'meta',
    ]);
  });
});
