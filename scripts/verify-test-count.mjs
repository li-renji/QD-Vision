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
 * 「磁盘上应该存在的测试文件**集合**」与「本次实际执行的测试文件**集合**」，
 * 不一致即以非 0 退出。
 *
 * 依赖各包的 Vitest JSON 报告（`--reporter=json --outputFile=./test-results.json`）。
 *
 * ## 为什么比「集合」而不是「数量」（第七轮复核修订）
 *
 * 初版只比对**数量**（`actual.count !== expectedFiles.length`），存在两类**假绿**：
 *
 * - **S2 · 报告与磁盘同时缺 1 个文件**：数量同时变小 → 相等 → exit 0。
 *   但这正是「某个测试文件被静默丢弃」本身 —— 守门器反而放行了它。
 * - **S3 · 陈旧报告**：报告里少跑了一个真实文件、却多了一条磁盘上已不存在的
 *   条目（例如上一次运行遗留的 `test-results.json`）→ 数量恰好相等 → exit 0。
 *
 * 两个来源「同时出问题」时，只比数量必然漏检。**只有比对文件名集合**才能
 * 识别「少跑了 A」与「多跑了 B」是两个不同的文件，从而正确拦截。
 *
 * 详见 `docs/QA_REPORT.md` 第七轮复核章节。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/**
 * 需要校验的包。
 *
 * `include` 必须与各包 `vitest.config.ts` 的 `test.include` **保持一致** ——
 * 否则守门器的「期望集合」本身就错了（第七轮复核 S4 场景）。
 */
const PACKAGES = [
  { name: 'app', root: path.join(repoRoot, 'packages/app'), include: /\.test\.(ts|tsx)$/ },
  { name: 'shared-types', root: path.join(repoRoot, 'packages/shared-types'), include: /\.test\.ts$/ },
];

/** 递归收集测试文件（返回相对仓库根的 POSIX 风格路径）。 */
function collectTestFiles(dir, includePattern, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTestFiles(full, includePattern, acc);
    } else if (includePattern.test(entry)) {
      acc.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
    }
  }
  return acc;
}

/**
 * 读取 Vitest JSON 报告里实际执行的测试文件**集合**。
 *
 * 报告条目形如 `{ name: 'C:/abs/path/to/foo.test.ts', status: 'passed' }`，
 * `name` 是绝对路径 —— 统一转成相对仓库根的 POSIX 风格路径后与磁盘集合比对。
 */
function readActualFiles(reportPath) {
  if (!existsSync(reportPath)) return { files: null, reason: `报告不存在：${reportPath}` };
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    if (!Array.isArray(report?.testResults)) {
      return { files: null, reason: `报告缺少 testResults：${reportPath}` };
    }
    const files = report.testResults
      .map((entry) => {
        const abs = typeof entry?.name === 'string' ? entry.name : '';
        if (!abs) return null;
        const rel = path.relative(repoRoot, abs.replace(/\\/g, '/'));
        // 报告里的路径若不在本仓库内（理论上不该出现），标记出来以便报告
        return rel.startsWith('..') ? `!外部路径!${abs}` : rel.replace(/\\/g, '/');
      })
      .filter((f) => f !== null);
    return { files, reason: null };
  } catch (error) {
    return { files: null, reason: `报告解析失败：${error instanceof Error ? error.message : error}` };
  }
}

/** 求两个集合的差集（a 中有、b 中没有的）。 */
function difference(a, b) {
  const set = new Set(b);
  return a.filter((item) => !set.has(item));
}

let failed = false;

console.log('[verify-test-count] 测试文件守门：');
for (const pkg of PACKAGES) {
  const expectedFiles = collectTestFiles(path.join(pkg.root, 'src'), pkg.include);
  const reportPath = path.join(pkg.root, 'test-results.json');
  const actual = readActualFiles(reportPath);

  if (actual.files === null) {
    console.error(`  ❌ ${pkg.name}: ${actual.reason}`);
    failed = true;
    continue;
  }

  const actualFiles = actual.files;
  // 「该跑却没跑」：磁盘上有、报告里没有 → 文件被静默丢弃
  const missing = difference(expectedFiles, actualFiles);
  // 「不该跑却跑了」：报告里有、磁盘上没有 → 报告陈旧或包含磁盘上不存在的文件
  const unexpected = difference(actualFiles, expectedFiles);

  if (missing.length > 0 || unexpected.length > 0) {
    if (missing.length > 0) {
      console.error(
        `  ❌ ${pkg.name}: ${missing.length} 个测试文件在磁盘上存在但未被执行 —— ` +
          `有文件被静默丢弃，本次结果不可信。` +
          `（磁盘 ${expectedFiles.length} 个 / 实际执行 ${actualFiles.length} 个）`,
      );
      for (const file of missing) console.error(`       - 未执行：${file}`);
    }
    if (unexpected.length > 0) {
      console.error(
        `  ❌ ${pkg.name}: 报告中出现 ${unexpected.length} 个磁盘上不存在的测试文件 —— ` +
          `报告不完整或已陈旧，本次结果不可信。`,
      );
      for (const file of unexpected) console.error(`       - 报告中多出：${file}`);
    }
    failed = true;
    continue;
  }

  console.log(
    `  ✅ ${pkg.name}: ${actualFiles.length} 个测试文件全部执行` +
      `（磁盘 ${expectedFiles.length} 个，集合完全一致）`,
  );
}

if (failed) {
  console.error(
    '\n[verify-test-count] ❌ 守门失败。\n' +
      '  常见原因：受限文件系统环境下 Vitest worker 崩溃导致文件被静默丢弃。\n' +
      '  ⚠️ 请勿把本次结果当作「测试通过」——它漏跑了测试。',
  );
  process.exit(1);
}

console.log('[verify-test-count] ✅ 全部包的测试文件集合与磁盘完全一致。');
