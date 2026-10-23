/**
 * 版本兼容层测试（FR-001③ / FR-004③）。
 */

import { describe, expect, it } from 'vitest';
import { deserialize } from '../deserialize.js';
import {
  compareSemver,
  isSupportedVersion,
  migrateDoc,
  semverGt,
  UnsupportedSchemaVersionError,
} from '../migrate.js';
import { readFixtureJson } from '../../../test/fixtures.js';

describe('domain/project/migrate', () => {
  it('低版本文件加载不抛异常，并补齐缺省字段', () => {
    const doc = deserialize(readFixtureJson('legacy-0.9.clipcut.json'));
    expect(doc.schemaVersion).toBe('1.0.0');
    expect(doc.settings.ai.routes).toBeDefined();
    expect(doc.settings.ai.providers).toBeDefined();
    expect(doc.tracks[0]?.clips[0]?.zIndex).toBe(0);
    expect(doc.tracks[0]?.clips[0]?.transform).toBeDefined();
    expect(doc.tracks[0]?.clips[0]?.audio).toBeDefined();
  });

  it('高版本文件被明确拒绝', () => {
    const json = readFixtureJson('minimal.clipcut.json') as Record<string, unknown>;
    json['schemaVersion'] = '2.0.0';

    expect(() => deserialize(json)).toThrowError(UnsupportedSchemaVersionError);
    try {
      deserialize(json);
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSchemaVersionError);
      expect((error as UnsupportedSchemaVersionError).fileVersion).toBe('2.0.0');
      expect((error as UnsupportedSchemaVersionError).message).toContain('版本过高');
    }
  });

  it('版本比较工具行为正确', () => {
    expect(semverGt('2.0.0', '1.0.0')).toBe(true);
    expect(semverGt('1.0.0', '1.0.0')).toBe(false);
    expect(semverGt('1.0.0', '1.0.1')).toBe(false);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(isSupportedVersion('1.0.0')).toBe(true);
    expect(isSupportedVersion('0.9.0')).toBe(true);
    expect(isSupportedVersion('2.0.0')).toBe(false);
  });

  it('当前版本文件不做任何改写', () => {
    const json = readFixtureJson('minimal.clipcut.json');
    const migrated = migrateDoc(json as never);
    expect(migrated).toBe(json);
  });
});
