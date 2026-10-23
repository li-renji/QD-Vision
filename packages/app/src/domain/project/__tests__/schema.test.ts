/**
 * JSON Schema 校验测试（schema:check）。
 *
 * 校验 3 个 fixture 全部通过 Ajv 校验。
 */

import { describe, expect, it } from 'vitest';
import { validateProjectDoc } from '../validation.js';
import { FIXTURE_NAMES, readFixtureJson } from '../../../test/fixtures.js';

describe('domain/project/schema', () => {
  it.each(FIXTURE_NAMES)('夹具 %s 通过 JSON Schema 校验', (name) => {
    const issues = validateProjectDoc(readFixtureJson(name));
    expect(issues.map((issue) => issue.hint)).toEqual([]);
  });

  it('缺少必填字段时给出中文提示', () => {
    const json = readFixtureJson('minimal.clipcut.json') as Record<string, unknown>;
    delete json['tracks'];
    const issues = validateProjectDoc(json);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.hint.includes('缺少必填字段'))).toBe(true);
  });

  it('schemaVersion 格式非法时报错', () => {
    const json = readFixtureJson('minimal.clipcut.json') as Record<string, unknown>;
    json['schemaVersion'] = 'not-a-version';
    const issues = validateProjectDoc(json);
    expect(issues.length).toBeGreaterThan(0);
  });
});
