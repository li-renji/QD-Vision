/**
 * 测试夹具工具：读取仓库根 `fixtures/` 下的工程文件。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本文件所在目录。 */
const here = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录。 */
export const repoRoot = path.resolve(here, '..', '..', '..', '..');

/** 夹具目录。 */
export const fixturesDir = path.join(repoRoot, 'fixtures');

/** 读取一个夹具文件（UTF-8 文本）。 */
export function readFixtureText(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf-8');
}

/** 读取一个夹具文件并解析为 JSON。 */
export function readFixtureJson(name: string): unknown {
  return JSON.parse(readFixtureText(name)) as unknown;
}

/** 全部夹具文件名。 */
export const FIXTURE_NAMES = [
  'minimal.clipcut.json',
  'full.clipcut.json',
  'legacy-0.9.clipcut.json',
] as const;
