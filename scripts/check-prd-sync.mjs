#!/usr/bin/env node
/**
 * PRD ↔ TASKS 同步守门器（PRD §9.14 · `pnpm check:prd-sync`）。
 *
 * ## 为什么需要
 *
 * 本项目已**三次**实测到「状态错位」：
 * - T15 已 completed，而 FR-018③ 属其范围；
 * - T12 已 completed，而 D-003 建议并入；
 * - NEW-BUG-01 若不立项将同样挂空。
 *
 * 根因是：**覆盖率核对的依据是任务状态，而需求可以落在已完成任务之下**，
 * 于是「任务完成」被误读成「需求已交付」。本脚本把这类错位变成**硬失败**。
 *
 * ## 判据（PRD §9.14）
 *
 * 1. 解析 PRD 中所有 P0 的 FR 编号；
 * 2. 解析 TASKS.md 每个任务的「覆盖 FR」声明；
 * 3. 断言：每个 P0 FR 都能映射到一个任务条目；
 * 4. 断言：PRD 第 9 章新增的 FR 条目（FR-018③ / FR-038② / FR-063 / FR-064）
 *    同样有对应任务条目，且该任务**显式标记**为「新增」或「返工」；
 * 5. 断言：PRD §3.11 统计表中的 P0 / P1 数量与正文中实际标记的数量一致；
 * 6. 断言：`domain/` 下不存在「校验 / 钳制表仅被单一入口使用」的结构
 *    —— 任何 `*_RANGES` / `*_LIMITS` 常量表必须被**多个入口**使用，
 *    且必须能**从导入路径**（`domain/project/deserialize.ts`）到达。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const prdPath = path.join(repoRoot, 'docs/PRD.md');
const tasksPath = path.join(repoRoot, 'docs/TASKS.md');
const domainDir = path.join(repoRoot, 'packages/app/src/domain');

const prd = readFileSync(prdPath, 'utf-8');
const tasks = readFileSync(tasksPath, 'utf-8');

/** 判据失败原因。 */
const problems = [];
/** 提示信息。 */
const notes = [];

// ============ 判据 1：解析 PRD 的 FR 优先级 ============

/** FR 编号 → 优先级。 */
const frPriority = new Map();

for (const line of prd.split('\n')) {
  // 形如：`| FR-001 | P0 | ...` 或 `| FR-064 | **P0** | ...`
  const match = /^\|\s*(FR-\d{3})\s*\|\s*\*{0,2}(P[012])\*{0,2}\s*\|/.exec(line);
  if (match) {
    frPriority.set(match[1], match[2]);
  }
}

const p0Frs = [...frPriority.entries()].filter(([, p]) => p === 'P0').map(([id]) => id).sort();
const p1Frs = [...frPriority.entries()].filter(([, p]) => p === 'P1').map(([id]) => id).sort();

notes.push(`PRD 正文解析到 P0 ${p0Frs.length} 条、P1 ${p1Frs.length} 条 FR。`);

// ============ 判据 2：解析 TASKS.md 的「任务 → FR」矩阵 ============

/**
 * 展开 FR 声明单元：既支持单个 `FR-013`，也支持区间 `FR-013 ~ FR-022`。
 */
function expandFrs(cell) {
  const frs = new Set(cell.match(/FR-\d{3}/g) ?? []);
  for (const range of cell.matchAll(/FR-(\d{3})\s*[~～\-—]\s*FR-(\d{3})/g)) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) {
      frs.add(`FR-${String(n).padStart(3, '0')}`);
    }
  }
  return [...frs].sort();
}

/** 任务 id → 声明覆盖的 FR 列表。 */
const taskToFrs = new Map();
/** 任务 id → 是否显式标记为「新增」或「返工」。 */
const taskIsNew = new Map();

for (const line of tasks.split('\n')) {
  const row = /^\|\s*(T\d{2})\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
  if (!row) continue;
  const [, taskId, frCell] = row;
  const frs = expandFrs(frCell);
  if (frs.length > 0) {
    taskToFrs.set(taskId, frs);
  }
}

/** 解析任务条目里的「状态」行，识别「新增」/「返工」。 */
for (const block of tasks.split(/^## /m)) {
  const idMatch = /^(T\d{2})\s*·/.exec(block);
  if (!idMatch) continue;
  const taskId = idMatch[1];
  const statusMatch = /\|\s*\*\*状态\*\*\s*\|\s*(.+?)\s*\|/.exec(block);
  if (statusMatch) {
    const status = statusMatch[1];
    taskIsNew.set(taskId, status.includes('新增') || status.includes('返工'));
  }
}

/** FR → 覆盖它的任务列表。 */
const frToTasks = new Map();
for (const [taskId, frs] of taskToFrs) {
  for (const fr of frs) {
    const list = frToTasks.get(fr) ?? [];
    list.push(taskId);
    frToTasks.set(fr, list);
  }
}

// ============ 判据 3：每个 P0 FR 都能映射到任务 ============

for (const fr of p0Frs) {
  const mapped = frToTasks.get(fr);
  if (!mapped || mapped.length === 0) {
    problems.push(`判据 3：P0 需求 ${fr} 在 TASKS.md 的追溯矩阵里**没有任何任务覆盖**。`);
  }
}

// ============ 判据 4：第 9 章新增的 FR 必须有显式立项的任务 ============

/**
 * 第 9 章追加的需求条目。
 * - FR-063 / FR-064 是**新增 FR 编号**；
 * - FR-018③ / FR-038② 是既有 FR 的**新增子项**（原本落在已 completed 的 T15 / T12 之下）。
 */
const CHAPTER9_REQUIREMENTS = ['FR-018', 'FR-038', 'FR-063', 'FR-064'];

for (const id of CHAPTER9_REQUIREMENTS) {
  const mapped = frToTasks.get(id) ?? [];
  const hasExplicit = mapped.some((taskId) => taskIsNew.get(taskId) === true);
  if (!hasExplicit) {
    problems.push(
      `判据 4：第 9 章新增条目 ${id} 只映射到任务 [${mapped.join(', ') || '无'}]，` +
        '其中**没有**显式标记为「新增」或「返工」的任务条目。',
    );
  }
}

// ============ 判据 5：§3.11 统计表与正文实际数量一致 ============

/** 取统计表某优先级行的数字（优先加粗的最终值，其次「=」后的数字）。 */
function parseStatsRow(priority) {
  const row = new RegExp(`^\\|\\s*\\*{0,2}${priority}\\*{0,2}\\s*\\|(.+?)\\|`, 'm').exec(prd);
  if (!row) return null;
  const cell = row[1];
  const bold = /\*\*(\d+)\*\*/.exec(cell);
  if (bold) return Number(bold[1]);
  const afterEq = /=\s*(\d+)/.exec(cell);
  if (afterEq) return Number(afterEq[1]);
  const numbers = (cell.match(/\d+/g) ?? []).map(Number);
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

for (const [priority, actual] of [
  ['P0', p0Frs.length],
  ['P1', p1Frs.length],
]) {
  const declared = parseStatsRow(priority);
  if (declared === null) {
    problems.push(`判据 5：PRD §3.11 统计表里找不到 ${priority} 行。`);
    continue;
  }
  if (declared !== actual) {
    problems.push(
      `判据 5：PRD §3.11 声明 ${priority} 共 ${declared} 条，` +
        `但正文实际标记为 ${priority} 的 FR 有 ${actual} 条 —— 统计表已漂移。`,
    );
  }
}

// ============ 判据 6：约束表不得只挂在单一入口 ============

/** 递归收集 domain/ 下的源文件（排除测试）。 */
function collectSources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSources(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceFiles = collectSources(domainDir);
const sourceContents = new Map(
  sourceFiles.map((file) => [file, readFileSync(file, 'utf-8')]),
);

const rel = (f) => path.relative(repoRoot, f).replace(/\\/g, '/');

/**
 * 找出领域层的**公开钳制 API**（导出的、名字以 `clamp` 开头的函数）。
 *
 * 判据 6 的检查单位是「钳制 API 的生效入口」而不是「常量名的引用点」——
 * 因为约束表通常由一个 clamp 函数封装，真正要保证的是
 * **这个函数在多个入口被调用**（尤其是导入路径）。
 */
const clampApis = [];
for (const [file, content] of sourceContents) {
  for (const match of content.matchAll(
    /export\s+function\s+(clamp[A-Za-z0-9_]*)\s*\(/g,
  )) {
    clampApis.push({ name: match[1], file });
  }
}

/**
 * 提取某个导出函数的**函数体**文本（大括号配平）。
 *
 * 判据 6 必须按「函数体」判定引用关系 —— 否则同一文件里的其它函数
 * 提到该表名就会造成误判（守门器变成摆设）。
 */
function functionBody(content, name) {
  const start = content.indexOf(`function ${name}(`);
  if (start < 0) return '';
  let depth = 0;
  let opened = false;
  for (let i = start; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '{') {
      depth += 1;
      opened = true;
    } else if (ch === '}') {
      depth -= 1;
      if (opened && depth === 0) {
        return content.slice(start, i + 1);
      }
    }
  }
  return '';
}

/**
 * 某个 API 的**调用点**（排除 import 语句与定义处）。
 *
 * ⚠️ 必须排除 import 语句 —— 否则「只 import 不用」会被误判成「已生效」，
 *    守门器就会变成摆设（变异测试可证伪这一点）。
 */
function apiCallSites(api) {
  const users = [];
  for (const [file, rawContent] of sourceContents) {
    if (file === api.file) continue;
    // 去掉 import 语句，只看真正的调用
    const content = rawContent.replace(/import\s+[^;]*?from\s+['"][^'"]+['"];?/gs, '');
    if (new RegExp(`\\b${api.name}\\s*\\(`).test(content)) {
      users.push(file);
    }
  }
  return users;
}

/** 约束表 → 声明它的文件。 */
const tableDeclarations = new Map();
for (const [file, content] of sourceContents) {
  for (const match of content.matchAll(
    /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*(?:_RANGES|_LIMITS|_CONSTRAINTS))\b/g,
  )) {
    const name = match[1];
    if (!tableDeclarations.has(name)) tableDeclarations.set(name, []);
    tableDeclarations.get(name).push(file);
  }
}

const checkedTables = [];

/**
 * 判据 6：每张约束表都必须在**多个入口**实际生效，
 * 且必须包含导入路径（`domain/project/deserialize.ts`）。
 *
 * 「实际生效」= 引用该表的 clamp API 存在 ≥1 个**调用点**（不只是 import）。
 */
for (const [table] of tableDeclarations) {
  // 哪些 clamp API 的**函数体**里引用了该表
  const apis = clampApis.filter((api) => {
    const body = functionBody(sourceContents.get(api.file) ?? '', api.name);
    return new RegExp(`\\b${table}\\b`).test(body);
  });

  if (apis.length === 0) {
    problems.push(
      `判据 6：约束表 \`${table}\` 没有被任何 clamp API 引用 —— ` +
        '它不会被任何入口实际执行，属于「看起来有约束、实际没生效」。',
    );
    continue;
  }

  // 该表的所有生效入口：
  //  (a) 调用了「函数体里用到该表」的 clamp API
  //  (b) 直接把该表传给通用钳制函数（clampNumericValues(root, ranges)）
  const callSites = new Set();
  for (const api of apis) {
    for (const file of apiCallSites(api)) {
      callSites.add(rel(file));
    }
  }
  for (const [file, rawContent] of sourceContents) {
    const content = rawContent.replace(/import\s+[^;]*?from\s+['"][^'"]+['"];?/gs, '');
    if (new RegExp(`\\b${table}\\b`).test(content)) {
      callSites.add(rel(file));
    }
  }

  checkedTables.push({ table, files: [...callSites] });

  if (callSites.size < 2) {
    problems.push(
      `判据 6：约束表 \`${table}\` 只在 ${[...callSites].join(', ') || '（无调用点）'} 生效 —— ` +
        '「校验 / 钳制表只挂单一入口」是本项目 4 项缺口的**共同根因**，必须被多个入口共用。',
    );
  }

  const hasImportPath = [...callSites].some((f) =>
    f.endsWith('domain/project/deserialize.ts'),
  );
  if (!hasImportPath) {
    problems.push(
      `判据 6：约束表 \`${table}\` **没有在导入路径**（domain/project/deserialize.ts）生效 —— ` +
        '导入外部工程文件时会绕过该约束。',
    );
  }
}

// ============ 输出 ============

console.log('[check:prd-sync] PRD ↔ TASKS 同步守门：');
for (const note of notes) console.log(`  · ${note}`);
if (checkedTables.length > 0) {
  console.log('  · 检查的约束表：');
  for (const { table, files } of checkedTables) {
    console.log(`      ${table} → ${files.length} 个入口：${files.join(', ') || '（无）'}`);
  }
}

if (problems.length > 0) {
  console.error('\n[check:prd-sync] ❌ 同步校验失败：');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n  ⚠️ P0 需求与任务立项已不同步。这正是本项目已三次踩到的「状态错位」。\n' +
      '     请在 docs/TASKS.md 补充/修正任务条目（新增或返工需显式标注），' +
      '或修正 PRD 的覆盖声明。',
  );
  process.exit(1);
}

console.log('\n[check:prd-sync] ✅ PRD 与 TASKS.md 同步，6 条判据全部通过。');
