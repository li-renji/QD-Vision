#!/usr/bin/env node
/**
 * 测试文件数守门器。
 *
 * ## 为什么需要它
 *
 * 在**受限文件系统环境**（某些沙箱 / 容器）下，Vitest 2 写模块缓存到
 * `<os.tmpdir()>/<random>/web/<hash>` 会被拒绝（EPERM），导致某个 worker 崩溃、
 * **随机**丢失一整个测试文件。此时：
 * - 用例全部通过，看起来是绿的；
 * - 但实际执行的测试文件比应有的**少**，覆盖率数据也会偏低；
 * - 退出码可能变成 1，也可能仍是 0。
 *
 * 这类「随机少跑几个文件」的假象**极易被误判成代码问题**。
 *
 * 本脚本把这种静默降级变成**硬失败**：比对
 * 「磁盘上应该存在的测试文件数」与「本次实际执行的测试文件数」，
 * 不一致即以非 0 退出。
 *
 * 依赖各包的 Vitest JSON 报告（`--reporter=json --outputFile=./test-results.json`）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** 需要校验的包。 */
const PACKAGES = [
  { name: 'app', root: path.join(repoRoot, 'packages/app') },
  { name: 'shared-types', root: path.join(repoRoot, 'packages/shared-types') },
];

/** 递归收集测试文件。 */
function collectTestFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTestFiles(full, acc);
    } else if (/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
    }
  }
  return acc;
}

/** 读取 Vitest JSON 报告里的实际执行文件数。 */
function readActualFileCount(reportPath) {
  if (!existsSync(reportPath)) return { count: null, reason: `报告不存在：${reportPath}` };
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    if (!Array.isArray(report?.testResults)) {
      return { count: null, reason: `报告缺少 testResults：${reportPath}` };
    }
    return { count: report.testResults.length, reason: null };
  } catch (error) {
    return { count: null, reason: `报告解析失败：${error instanceof Error ? error.message : error}` };
  }
}

let failed = false;

console.log('[verify-test-count] 测试文件守门：');
for (const pkg of PACKAGES) {
  const expectedFiles = collectTestFiles(path.join(pkg.root, 'src'));
  const reportPath = path.join(pkg.root, 'test-results.json');
  const actual = readActualFileCount(reportPath);

  if (actual.count === null) {
    console.error(`  ❌ ${pkg.name}: ${actual.reason}`);
    failed = true;
    continue;
  }

  if (actual.count !== expectedFiles.length) {
    console.error(
      `  ❌ ${pkg.name}: 实际执行 ${actual.count} 个测试文件，` +
        `磁盘上应有 ${expectedFiles.length} 个 —— 有文件被静默丢弃，本次结果不可信。`,
    );
    for (const file of expectedFiles) console.error(`       - ${file}`);
    failed = true;
    continue;
  }

  console.log(`  ✅ ${pkg.name}: ${actual.count} 个测试文件全部执行（预期 ${expectedFiles.length}）`);
}

if (failed) {
  console.error(
    '\n[verify-test-count] ❌ 守门失败。\n' +
      '  常见原因：受限文件系统环境下 Vitest worker 崩溃导致文件被静默丢弃。\n' +
      '  ⚠️ 请勿把本次结果当作「测试通过」——它漏跑了测试。',
  );
  process.exit(1);
}

console.log('[verify-test-count] ✅ 全部包的测试文件数与预期一致。');
