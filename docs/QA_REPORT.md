# ClipCut Web · V1.0 MVP 独立 QA 验证报告

> 报告作者：严过关（Yan）· QA Engineer
> 报告日期：2026-10-23
> 验证对象：`C:\Users\renji\WorkBuddy\2026-10-23-01-23-32`
> 验证方式：**独立实测**（实际执行命令 + grep 实测 + 变异测试），不采信实现者自述
> 依据文档：`docs/PRD.md`（FR-001~FR-062）、`docs/TASKS.md`（T01~T20）、`docs/ARCHITECTURE.md`

---

## 0. 智能路由判定（结论先行）

### 判定结果：**`Engineer`** — 发现源码 Bug，需工程师修复

| 项 | 结论 |
|---|---|
| 验证命令通过率 | **5/5（100%）** — lint / typecheck / test / build / schema:check 全绿 |
| 测试用例通过率 | **136/136（100%）**（app 129 + shared-types 7） |
| domain 行覆盖率 | **93.13%**（实测复现，与自述一致） |
| 架构三硬约束 | **全部实测通过** |
| **发现源码缺陷** | **1 个（阻塞级）** — 详见 §5.1 |
| 发现测试盲区 | 6 项（重要/次要） |
| 发现其他问题 | 3 项（重要 1 / 次要 2） |

**判定理由**：所有既有验证命令均通过，架构约束真实落地，工程师自述的 `fillMissing` 缺陷修复经变异测试确认**真实有效**。但通过**独立构造的边界用例**发现：`fixClipDuration` 与 PRD §4.1 时长不变式、及与 `assertClipInvariants` 之间存在**自相矛盾**，且可经公开 API `setClipSpeed` 复现，产出违反 PRD 硬不变式的工程数据。这是**源码逻辑缺陷**（非测试代码问题），故路由至 `Engineer`。

---

## 1. 验证命令真实执行结果

全部命令在 `C:\Users\renji\WorkBuddy\2026-10-23-01-23-32` 下**实际执行**，非文件存在性推断。

| # | 命令 | 退出码 | 结果 | 关键输出摘录 |
|---|---|---|---|---|
| 1 | `pnpm lint` | **0** | ✅ 通过 | `$ eslint .` — 零 error、零 warning |
| 2 | `pnpm typecheck` | **0** | ✅ 通过 | shared-types / ai-provider-sdk / mcp-server / app 四包 `tsc --noEmit` 全部 `Done` |
| 3 | `pnpm test` | **0** | ✅ 通过 | app `Test Files 20 passed (20)` / `Tests 129 passed (129)`；shared-types `1 passed` / `7 passed` |
| 4 | `pnpm build` | **0** | ✅ 通过 | 4 包全部 `Done`；app `✓ 495 modules transformed`，产物 5 个文件（index.html + 3 JS + 1 CSS + favicon + manifest） |
| 5 | `pnpm schema:check` | **0** | ✅ 通过 | `schema.test.ts` `5 passed (5)` |

### 1.1 覆盖率实测（复现工程师自述）

```
% Coverage report from v8   （include = src/domain/**/*.ts，全量套件）
All files        |   93.13 |    69.29 |   94.44 |   93.13 |
  exportPlan.ts  |   84.74 |       70 |     100 |   84.74 |
  deserialize.ts |   89.51 |    48.05 |    87.5 |   89.51 |
  duration.ts    |     100 |      100 |     100 |     100 |
  factory.ts     |     100 |      100 |     100 |     100 |
  migrate.ts     |   96.26 |    37.73 |     100 |   96.26 |
  serialize.ts   |   98.04 |    84.61 |     100 |   98.04 |
  validation.ts  |   69.35 |    52.38 |      50 |   69.35 |
  srt.ts         |   86.66 |    60.34 |     100 |   86.66 |
  invariants.ts  |     100 |    94.44 |     100 |     100 |
  operations.ts  |   92.82 |    73.54 |      95 |   92.82 |
  selectors.ts   |     100 |      100 |     100 |     100 |
  snapping.ts    |     100 |      100 |     100 |     100 |
  transform.ts   |     100 |    71.42 |     100 |     100 |
```

✅ **93.13% 与自述完全一致**，且 ≥ TASKS T20 要求的 80%。`vitest.workspace.ts` 配置的 thresholds（lines 80 / statements 80 / functions 75 / branches 60）当前**全部满足**。

> **环境说明（非源码缺陷）**：`pnpm test:coverage` 全量运行在本机会因 `packages/app/node_modules/.vite/tmp` 的 Windows EPERM 权限问题挂起。已定位为**本机文件系统/沙箱环境限制**，非源码问题；通过 `--coverage.include` 限定到 domain 可正常产出报告。项目已内置 `redirectTempDir()` 规避该问题，但其 `mkdirSync` **未 import**（见 §5.4 次要缺陷）。
>
> **另注**：`pnpm check` 聚合脚本在本机需 >580s（`pnpm build` 的 vite 阶段在连续多轮执行后显著变慢），故聚合运行会在 build 阶段被外部 `SIGTERM`（exit 143）中断而报 `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`。**这不是源码缺陷**——拆开单独执行时 5 条命令均 `EXIT=0`（build 单独跑 `✓ built in 8.84s`，`schema:check` 连续 3 次均 `EXIT=0`）。CI 环境（ubuntu-latest，timeout 20min）无此问题。

---

## 2. 三条架构硬约束 —— grep 实测证据

> 方法：不读代码推测，直接全量 grep 源码目录。

### 规则 A：业务层零直接使用 localStorage / indexedDB / showOpenFilePicker

**实测命令**：`grep -rn "localStorage|sessionStorage|indexedDB|showOpenFilePicker|showSaveFilePicker|showDirectoryPicker|document\.cookie" packages/app/src`

**命中结果（全部集中在白名单目录）**：

| 文件 | 命中内容 | 判定 |
|---|---|---|
| `src/platform/WebPlatformBridge.ts` | `showOpenFilePicker` / `showSaveFilePicker` / `showDirectoryPicker` / `window.localStorage.setItem` 等 | ✅ 白名单（平台层唯一出口） |
| `src/platform/capabilities.ts` | `showOpenFilePicker?: unknown` 等能力探测 + `indexedDb: typeof indexedDB !== 'undefined'` | ✅ 白名单（平台层） |
| `src/services/storage/db.ts` | 仅注释声明"唯一允许直接访问 indexedDB 的位置" | ✅ 白名单（ESLint 已放行） |

**`domain/` `components/` `state/` `hooks/` `render/` 命中数 = 0** ✅

ESLint 规则落地确认（`eslint.config.js` L119-162）：
- 规则 A 主配置 → 白名单 1 `src/platform/**` → 白名单 2 `src/services/storage/db.ts`（且该文件**仍禁止** `localStorage`/`sessionStorage`，仅放开 `indexedDB`，设计正确）

### 规则 B：domain 与 services/media 零 fetch / XHR / sendBeacon / WebSocket（零上传硬验收）

**实测命令**：
- `grep -rE "\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource" packages/app/src/domain` → **No matches found** ✅
- `grep -rE "\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource" packages/app/src/services/media` → **No matches found** ✅

**补充实测（构建产物层面）**：
- `grep -roE "fetch\(['\"]https?://[^'\"]*" packages/app/dist/assets --include=*.js` → **无命中** ✅
- `grep -roE "wss?://[a-zA-Z0-9.:_-]+" packages/app/dist/assets --include=*.js` → **无命中** ✅

→ 零上传约束在**源码层与产物层双向实测通过**。

ESLint 规则 B 落地确认（L165-186）：`no-restricted-globals` 覆盖 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`，`no-restricted-properties` 覆盖 `navigator.sendBeacon`。

### 规则 C：ai-provider-sdk 零厂商 SDK

**实测命令**：`grep -rE "from ['\"](openai|@anthropic-ai|@google/generative-ai|azure|@azure/|@aws-sdk/|cohere-ai|mistralai|langchain)" packages/ai-provider-sdk` → **No matches found** ✅

**依赖清单实测**：

| 包 | dependencies | 判定 |
|---|---|---|
| `packages/ai-provider-sdk` | 仅 `@clipcut/shared-types: workspace:*` | ✅ 零厂商 SDK |
| `packages/shared-types` | `{}`（空对象） | ✅ 零运行时依赖 |
| `packages/app` | 无任何厂商 AI SDK | ✅ |
| `packages/mcp-server` | `@modelcontextprotocol/sdk` + `ws` | ✅ 官方 MCP SDK + WS，非 AI 厂商 SDK |

ESLint 规则 C 落地确认（L189-204）：`no-restricted-imports` 覆盖 18 组厂商模式。

### 2.4 附加：包依赖方向

**实测**：`grep -rn "mcp-server" packages/app/src packages/app/package.json` → **无命中** ✅

依赖方向实测符合自述：`app → {shared-types, ai-provider-sdk}`；`ai-provider-sdk → shared-types`；`mcp-server → shared-types`；**`app` 不依赖 `mcp-server`** ✅

---

## 3. 关键单测有效性抽查（含变异测试实证）

### 3.1 抽查方法：变异测试（Mutation Testing）

> 不满足于"测试通过"，而是**主动破坏源码验证测试能否捕获**。方法：备份 → 注入缺陷 → 跑测试 → 观察是否失败 → 还原。

| 变异编号 | 注入的缺陷 | 测试结果 | 判定 |
|---|---|---|---|
| **MUT-1** | `fillMissing` 改回 `Object.assign`（复现工程师所修缺陷） | ❌ **2 个测试失败** | ✅ **捕获** |
| **MUT-2** | `fixClipDuration` 移除 `Math.max(raw, MIN_CLIP_DURATION_MS)` 钳制 | ❌ 测试失败 | ✅ **捕获** |
| **MUT-3** | `srt.ts` 移除 `cues.sort(...)` 排序 | ❌ 测试失败 | ✅ **捕获** |
| **MUT-4** | `trimClip` 移除素材越界钳制 `Math.min(outMs, assetDuration)` | ❌ 测试失败（`expected 24000 to be ≤ 14000`） | ✅ **捕获** |
| **MUT-5** | `setClipSpeed` 移除 `durationMs` 重算 | ❌ 测试失败（`expected 12000 to be 6000`） | ✅ **捕获** |

**结论：5/5 变异全部被捕获** — 关键单测**真实验证行为**，非"只断言不抛错"的空测试。

> 注：过程中曾因 Vite 缓存导致 MUT-5 一度误判为"未捕获"，清除缓存后复测确认捕获。所有变异均已**逐一还原并验证源码文件内容与原始一致**，最终 `pnpm lint` / `typecheck` / `test` 复跑全绿。

### 3.2 重点断言质量抽查

**① 不变式 `durationMs === (outMs-inMs)/speed`**（`operations.test.ts` L151-161）
```ts
const result = setClipSpeed(makeContext(doc), 'clip_full_c1', 2);
expect(clip?.inMs).toBe(1000);
expect(clip?.outMs).toBe(13_000);
expect(clip?.durationMs).toBe(6000);                              // 具体值断言
expect(clip?.durationMs).toBe(Math.round((13_000 - 1000) / 2));    // 公式断言
assertAllInvariants(result.doc);                                    // 全局不变式复验
```
✅ **同时断言具体值 + 公式 + 全局不变式**，且经 MUT-5 证明可捕获真实回归。

**② 未知字段保留**（`unknownFields.test.ts`，5 个用例）
- 根级 `customFoo`、嵌套 `customTrackField`、clip 内 `customClipField` 三层分别验证
- 额外含**往返一致性**断言：`serialize(deserialize(x))` 两次结果 `toBe(first)`（逐字节）
✅ 真实断言字段值，非空跑。

**③ SRT 往返**（`srt.test.ts` L85-107）
```ts
const second = parseSrt(stringifySrt(first.cues));
expect(second.cues).toHaveLength(first.cues.length);
for (let i...) {
  expect(second.cues[i]?.startMs).toBe(first.cues[i]?.startMs);  // 逐条逐字段比对
  expect(second.cues[i]?.endMs).toBe(first.cues[i]?.endMs);
  expect(second.cues[i]?.text).toBe(first.cues[i]?.text);
}
```
✅ 真正的逐字段往返比对；另有 `errorCount: 2` 精确断言、2000 条压力用例、`detectOverlaps` 区间断言。

**④ 撤销栈深度**（`history.test.ts`，7 个用例）
- 连续 60 次编辑 → `past.length === 60` → 连续 60 次撤销 → **深比较 `toEqual(initial)`** ✅
- 上限 100 步、redo 恢复、**一次操作仅 1 条历史**、新操作清空 future、保存后 reset —— 全部为行为断言
✅ 经审查无空跑断言。

**⑤ 序列化逐字节一致**（`serialize.test.ts`）
- 3 个 fixture 全部 `expect(second).toBe(first)`（字符串逐字节）
- 额外验证**键序规范**（canonical 顺序 + 未知字段排在已知字段之后且保持相对顺序）
✅ 质量高于验收标准要求。

---

## 4. 缺陷列表

### 4.1 缺陷汇总

| 编号 | 严重级别 | 类别 | 位置 | 一句话 |
|---|---|---|---|---|
| **BUG-01** | **阻塞** | 源码逻辑 | `domain/timeline/invariants.ts` | `fixClipDuration` 与 PRD §4.1 不变式、且与 `assertClipInvariants` 自相矛盾 |
| **BUG-02** | 重要 | 测试盲区 | `services/storage/autoSave.ts` | FR-005 自动保存 3s 防抖 + beforeunload 零测试覆盖 |
| **BUG-03** | 重要 | 测试盲区 | `services/media/audioEngine.ts` / `audioGraph.ts` | FR-020③④ / FR-034 / FR-035 混音总线零测试覆盖 |
| **BUG-04** | 重要 | 测试盲区 | `services/export/webCodecsExporter.ts` 等 | FR-039/040/041/042/043 导出管线零测试覆盖 |
| **BUG-05** | 次要 | 测试盲区 | `domain/project/validation.ts` | 行覆盖 69.35%、分支 52.38%、函数 50%，Schema 校验错误路径覆盖不足 |
| **BUG-06** | 次要 | 源码质量 | `vitest.workspace.ts` L22-28 | `mkdirSync` 未 import，函数静默失效 |
| **BUG-07** | 次要 | 工程 | `vitest.workspace.ts` | 未被任何 script 引用，配置形同虚设（实际生效的是各包内 vitest 配置） |

---

### BUG-01【阻塞】时长不变式在特定条件下被破坏，且与守卫函数自相矛盾

**文件**：`packages/app/src/domain/timeline/invariants.ts`

**问题描述**：

PRD §4.1 明确规定硬不变式：
> **时长不变式** | 恒有 `durationMs == (outMs - inMs) / speed`。任何变速/裁剪操作后必须重算，**不得产生不一致数据**。

但 `fixClipDuration`（L31-36）在计算时额外加了最小时长钳制：
```ts
export function fixClipDuration(clip: Clip): Clip {
  if (clip.assetId === null) return clip;
  const raw = Math.round((clip.outMs - clip.inMs) / clip.speed);
  const durationMs = Math.max(raw, MIN_CLIP_DURATION_MS);  // ← 钳到 100
  return { ...clip, durationMs };
}
```

而同文件的 `assertClipInvariants`（L57-64）校验时**不含**该钳制：
```ts
if (clip.assetId !== null) {
  const expected = Math.round((clip.outMs - clip.inMs) / clip.speed);  // ← 无钳制
  if (clip.durationMs !== expected) {
    throw new ClipInvariantError(...);
  }
}
```

**两个函数对同一不变式的定义不一致**：当 `(outMs - inMs) / speed < 100ms` 时，`fixClipDuration` 产出 `100`，而 `assertClipInvariants` 要求 `50` —— **fix 产出的数据必然被自己的 assert 判定为"违反不变式"**。PRD 只要求"最小 clip 时长 100ms"作为**操作入口的约束**（裁剪/变速时钳制），并未要求**重算函数篡改不变式结果**。

**复现方式**（已实测通过公开 API 复现）：

```ts
import { setClipSpeed } from './domain/timeline/operations.js';
import { assertClipInvariants } from './domain/timeline/invariants.js';

// clip: inMs=0, outMs=500, speed=1, durationMs=500；asset.durationMs=5000
const result = setClipSpeed({ doc, assets }, 'clip_v', 10);
const clip = result.doc.tracks[0].clips[0];

// 实测输出：
//   inMs=0  outMs=500  speed=10
//   durationMs=100    ← fixClipDuration 钳到 MIN_CLIP_DURATION_MS
//   PRD 不变式期望=50  ← (500-0)/10 = 50
//   一致=false
//   assert 抛错: durationMs 与 (outMs - inMs) / speed 不一致：100 !== 50
```

**触发条件**（用户可正常触发的路径）：
- FR-020 允许自定义 `0.1x ~ 10x` 变速；用户在属性面板把一个源区间 < 1000ms 的短 clip 调到高倍速（如 500ms 素材调到 10x）即命中。
- 同理适用于 `trimClip`（裁剪后时长趋近 100ms 边界）。

**严重级别**：**阻塞**
- 直接违反 PRD §4.1 明文硬不变式（"不得产生不一致数据"）；
- 产出**落盘的工程数据自带矛盾**：`serialize` 会把这个 `durationMs=100` 写进 `.clipcut.json`，重新加载后仍不一致；
- 影响下游：渲染器按 `(timeMs - startMs) * speed` 换算源时间，会与 `durationMs` 产生 **50ms 错位**，在 FR-039 要求的"音画同步误差 ≤ 40ms"口径下**超标**；
- `assertClipInvariants` / `assertAllClipInvariants` 目前**仅被测试调用**（已 grep 确认无生产调用点），意味着该矛盾不会被运行时捕获，只会静默写入错误数据。

**修复建议**（供工程师参考，QA 不代改源码）：
最小时长钳制应放在**操作入口**（`trimClip` / `setClipSpeed` 已有部分钳制），`fixClipDuration` 应忠实按公式重算：
```ts
export function fixClipDuration(clip: Clip): Clip {
  if (clip.assetId === null) return clip;
  return { ...clip, durationMs: Math.round((clip.outMs - clip.inMs) / clip.speed) };
}
```
并同步调整 `invariants.test.ts` L79 的期望值（`fixClipDuration(makeClip({speed:100}))` 当前断言为 `MIN_CLIP_DURATION_MS`，修正后应为 `10`）。**请注意此改动需一并复核 FR-017②"最小 clip 时长 100ms"的入口校验是否仍完整覆盖**。

---

### BUG-02【重要】FR-005 自动保存零测试覆盖

**文件**：`packages/app/src/services/storage/autoSave.ts`
**现状**：`src/services/storage/__tests__/` 下**仅有 `projectRepo.test.ts`**，无 `autoSave.test.ts`。
**已验证实现存在但无测试**：3s 防抖常量（`DEFAULT_DEBOUNCE_MS = 3000`）、`beforeunload` + `visibilitychange(hidden)` 双保险落盘（L110-111）、卸载时移除监听（L114-115）。
**风险**：FR-005①"强制刷新后最近 3s 内的编辑不丢"是 P0 验收项，当前**无任何自动化手段守护**；防抖时长被误改为 300ms 不会被发现。

---

### BUG-03【重要】音频引擎零测试覆盖

**文件**：`packages/app/src/services/media/audioEngine.ts`、`audioGraph.ts`、`worklets/pitchPreserveStretchProcessor.ts`
**现状**：`services/media/__tests__/` 下**仅有 `metadataProbe.test.ts`**。
**已验证实现存在但无测试**：`audioGraph.ts` L182-192 淡入淡出 `linearRampToValueAtTime`；`buildAudioGraph` 拓扑（多轨 GainNode → 轨道总线 → masterGain）；WSOLA 变速保音高 worklet。
**风险**：FR-020③（保音高）、FR-034（gain 0~2）、FR-035（预览与导出同一条总线）、FR-036（淡入淡出）均为 P0/P1，全无自动化守护。T11 自测验收项"speed=2 时音高不变（FFT 主频断言）""预览与导出使用同一份 buildAudioGraph"均无测试落地。

---

### BUG-04【重要】导出管线零测试覆盖

**文件**：`packages/app/src/services/export/` 全部（`webCodecsExporter.ts` 309 行 / `mediaRecorderExporter.ts` 137 行 / `exportController.ts` / `audioExporter.ts` / `download.ts`）
**现状**：`services/export/__tests__/` 下**仅有 `capabilityProbe.test.ts`**（4 个用例）。
**已验证实现存在但无测试**：WebCodecs 主路径完整实现（`Muxer` / `VideoEncoder` / `AudioEncoder` / `VideoFrame` / `OfflineAudioContext` / `renderFrame` 复用）；MediaRecorder 兜底路径；取消时 `close()` 与 ObjectURL revoke。
**风险**：FR-039（时长误差 ≤ 1 帧）、FR-040（WebCodecs 不可用自动降级）、FR-041（进度四要素）、FR-042（取消无内存泄漏 + 历史持久化）、FR-043（音频独立导出）均为 P0，全无自动化守护。FR-042②"导出记录持久化到 IndexedDB，刷新后仍在，且只保留 10 条"亦无测试（`exportHistoryRepo.ts` 的 `MAX_EXPORT_HISTORY = 10` 与裁剪逻辑未验证）。

---

### BUG-05【次要】Schema 校验错误路径覆盖不足

**文件**：`packages/app/src/domain/project/validation.ts`
**实测覆盖率**：行 **69.35%** / 分支 **52.38%** / 函数 **50%** —— 为 domain 内最低（对比 `invariants.ts` / `selectors.ts` / `snapping.ts` / `transform.ts` 均为 100% 行覆盖）。
**风险**：Ajv 结构化错误列表（path + message + 中文提示）的生成逻辑分支多，测试仅覆盖主路径；FR-004③"高版本拒绝并提示"虽在 `migrate.test.ts` 有覆盖，但**校验失败的多字段错误聚合**未验证。

---

### BUG-06【次要】`vitest.workspace.ts` 中 `mkdirSync` 未 import

**文件**：`vitest.workspace.ts` L22-28
```ts
function redirectTempDir(): void {
  const dir = resolvePath('./node_modules/.vite/tmp');
  try {
    mkdirSync(dir, { recursive: true });   // ← 未 import！
    process.env['TEMP'] = dir; ...
  } catch { /* 忽略 */ }
}
```
文件顶部仅有 `import { fileURLToPath } from 'node:url'` 与 `import { defineWorkspace } from 'vitest/config'`，**`mkdirSync` 未导入**。运行时抛 `ReferenceError` 被 `catch {}` 静默吞掉 → `redirectTempDir()` **实际从未生效**。

**加重因素**：该文件未被任何 `tsconfig` 的 `include` 覆盖（根 `tsconfig.json` 为 `files: []` + project references），且 ESLint 虽扫描该文件但 `no-undef` 在 TS 配置下未开启 → **typecheck 与 lint 双双漏过**。

---

### BUG-07【次要】`vitest.workspace.ts` 未被任何 script 引用

**文件**：`vitest.workspace.ts`
**实测**：`grep "workspace" package.json packages/*/package.json` → 仅命中 `workspace:*` 依赖声明，**无任何 script 引用该配置文件**；`pnpm test` 实际执行的是 `pnpm --filter @clipcut/app test`（即各包内的 `vitest run --root .`）。
**说明**：因此该文件里配置的 `coverage.include` / `thresholds` 等**在默认 `pnpm test` 路径下不生效**（覆盖率需通过手工指定 `--coverage.include` 才能复现，即 §1.1 的做法）。这解释了为何全量 `pnpm test:coverage` 会因 thresholds/EPERM 出现异常。TASKS T01 验收标准要求"`vitest.workspace.ts`：两个工程"，当前该文件与实际生效配置存在偏离，建议工程师确认意图并二选一：接线到 script，或删除以消除误导。

---

## 5. 工程师自述缺陷修复的验证结论

**结论：修复正确，且回归测试真实有效（判定通过 ✅）**

| 验证项 | 方法 | 结果 |
|---|---|---|
| `fillMissing` 实现是否只补缺失键 | 读源码 L47-53：`for (const [k,v] of Object.entries(defaults)) if (!(k in target)) target[k]=v` | ✅ 逻辑正确 |
| 调用点是否正确 | L78 `fillMissing(clip.transform, DEFAULT_TRANSFORM)`、L83 `fillMissing(clip.audio, DEFAULT_AUDIO_PROPS)` | ✅ 未误用于其他场景 |
| **回归测试能否捕获原缺陷** | **变异测试：把 `fillMissing` 改回 `Object.assign(target, defaults)`** | ✅ **捕获，2 个测试失败** |

**变异实证输出**：
```
FAIL |app| src/domain/project/__tests__/unknownFields.test.ts
  > clip 的 transform 与 audio 参数不被默认值覆盖
  AssertionError: expected 0.5 to be 0.75
  ❯ unknownFields.test.ts:68:30

FAIL |app| src/domain/timeline/__tests__/operations-extra.test.ts
  > 修改画布尺寸会换算 transform 与字号
  AssertionError: expected 0.28125 to be close to 0.421875
  ❯ operations-extra.test.ts:223:30
```

**逻辑分析（为何能捕获）**：
`unknownFields.test.ts` L65-78 断言 `clip_full_c2` 的 `transform.x/y/scale/opacity/cornerRadius` 为 `0.75/0.25/0.4/0.9/24`，`clip_full_c3` 的 `audio.gain/fadeInMs/fadeOutMs` 为 `0.8/500/500`。这些值**全部不等于** `DEFAULT_TRANSFORM` / `DEFAULT_AUDIO_PROPS` 的默认值。若 `fillMissing` 退化为 `Object.assign`，`x` 会被覆写为 `0.5`、`gain` 被覆写为 `1` → 断言立即失败。

**变异后已完整还原**（已 grep 校验 `fillMissing` 函数体与原始一致），还原后 `pnpm lint` / `typecheck` / `test` 复跑全绿。

---

## 6. FR 覆盖率对照表（47 条 P0）

> 图例：✅ 已实现且有测试 · 🟡 已实现但无测试 · 🔷 仅骨架（符合 PRD 约定） · ❌ 缺失

### 6.1 工程与存储（FR-001 ~ FR-005）

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-001 序列化/反序列化纯函数 | ✅ | `serialize.ts` / `deserialize.ts`；逐字节往返 + 3 fixture + 键序 + 时间取整 全覆盖 |
| FR-002 IndexedDB + blobKey 引用 | 🟡 | `db.ts` 4 表（projects/blobs/exports/settings）✅ 实现；`projectRepo.test.ts` 覆盖 CRUD 与 `getMissingBlobKeys`；**blobRepo / exportHistoryRepo / settingsRepo 无测试** |
| FR-003 新建/打开/另存 + 工程列表 | 🟡 | `components/project/` 5 个组件已实现；无测试 |
| FR-004 导入导出 .json + relink | 🟡 | 高版本拒绝 ✅ 有测试（`migrate.test.ts` 断言 `UnsupportedSchemaVersionError` + `fileVersion` + "版本过高"）；`getMissingBlobKeys` ✅ 有测试；`ImportProjectDialog` / `RelinkDialog` 无测试 |
| FR-005 自动保存 3s + beforeunload | 🟡 | 实现存在，**零测试** → **BUG-02** |

### 6.2 素材导入与管理（FR-006 ~ FR-012）

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-006 多格式导入 | 🟡 | `fileTypes.test.ts` 5 用例覆盖格式分类；`assetService.importFiles` 无测试 |
| FR-007 元数据解析 | ✅ | `metadataProbe.test.ts` 4 用例（含按类型分派，2s 超时用例） |
| FR-008 素材面板网格/列表 | 🟡 | 5 个组件已实现；无测试 |
| FR-009 缩略图/波形缓存 | 🟡 | `thumbnailService` / `waveformService` 已实现；无测试 |
| FR-010 拖拽到时间线生成 clip | ✅ | `operations.test.ts` `addClip` 系列（含图片默认 5s、跨类型拒绝） |
| FR-011 在线素材库 | ❌ | `MaterialSourceConnector` / `Pixabay` / `LocalFolderConnector` 全库 grep **零命中**。**P1，PRD 允许延后** |
| FR-012 第三方连接器接口 | ❌ | 同上，接口定义亦缺失。TASKS 附录记为"V1.0 不做"，但 FR-标为 P1 且 T14 声称覆盖 FR-012② |

### 6.3 时间线（FR-013 ~ FR-022）

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-013 多轨模型 | ✅ | `addTrack`/`removeTrack`/`setTrackFlags` + `orderedTracks` 选择器 |
| FR-014 静音/隐藏/锁定/高度 | ✅ | `setTrackFlags`；锁定态在 `addClip`/`moveClip`/`trimClip`/`splitClip`/`deleteClip` 全路径校验 |
| FR-015 标尺/播放头 | 🟡 | `TimelineRuler.tsx` / `Playhead.tsx` 已实现；无测试 |
| FR-016 clip 拖拽移动 | ✅ | `moveClip` + 跨类型 `IncompatibleTrackError` + 跨轨改序 |
| FR-017 边缘裁剪 | ✅ | `trimClip` + 越界钳制 + 最小 100ms；**经 MUT-4 验证可捕获回归** |
| FR-018 分割 | 🟡 | `splitClip` ✅ 有测试（1 帧边界 `NotSplittableError`）；**②"分割后生成第二段缩略图"未实现**（grep 零命中） |
| FR-019 删除/复制粘贴/多选 | ✅ | `deleteClip` / `duplicateClip`（保持 in/out/speed/transform）；多选在 uiStore |
| FR-020 基础变速 | ✅ | `setClipSpeed` 保持 inMs、重算 durationMs；**经 MUT-5 验证**；③保音高见 BUG-03 |
| FR-021 吸附系统 | ✅ | `snapping.ts` 行覆盖 **100%**；阈值 8px、播放头/首尾/整秒候选 |
| FR-022 缩放/滚动 | 🟡 | `useVirtualizedRows` / `TimelinePanel` 已实现；无测试 |

### 6.4 画面与预览（FR-023 ~ FR-027）

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-023 Canvas 2D 合成 | ✅ | `compositor.test.ts` 6 用例，断言绘制调用顺序 / hidden 轨排除 |
| FR-024 画中画 PIP | ✅ | `MAX_OVERLAY_LAYERS = 4` + 超限告警（compositor L99-100）；`drawImage.ts` L97-98 `cornerRadius` 实装 |
| FR-025 传输控制 | 🟡 | `PreviewControls.tsx` + `useHotkeys.ts`（含输入框聚焦禁用）已实现；无测试 |
| FR-026 画布比例预设 | ✅ | `transform.ts` 行覆盖 **100%**；`applyCanvasResize` x/y 按宽高比 + fontSize 按 /1080 |
| FR-027 缩略图条 | ❌ | `ClipView.tsx` 中 thumbnail/filmstrip **零命中**。**P1，PRD 允许延后** |

### 6.5 文字与字幕（FR-028 ~ FR-033）

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-028 文字片段编辑 | 🟡 | `TextSection.tsx` + `addTextClip` 已实现；无测试 |
| FR-029 文字样式 | 🟡 | `drawText.ts` + `CLIP_PROPERTY_PATHS` 27 条白名单；无测试 |
| FR-030 文字变换 | ✅ | `drawTransform.ts` 与 PIP 共用同一实现 |
| FR-031 SRT 导入 | ✅ | `srt.test.ts` 9 用例：`,`/`.` 分隔符、逐行容错 `errorCount: 2`、排序、重叠检测、2000 条压力；**经 MUT-3 验证** |
| FR-032 字幕轨 | 🟡 | `setSubtitleSettings` + `compositor` 烧录开关已实现；无测试 |
| FR-033 SRT 独立导出 | ✅ | `stringifySrt` 往返逐字段比对 100% |

### 6.6 音频（FR-034 ~ FR-037）

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-034 音量 gain 0~2 | 🟡 | `NUMERIC_RANGES['audio.gain'] = [0,2]` 钳制 ✅ 有测试；实时可听路径无测试 → **BUG-03** |
| FR-035 混音总线 | 🟡 | `audioGraph.ts` 存在；"预览与导出同一份代码"无自动化验证 → **BUG-03** |
| FR-036 淡入淡出 | 🟡 | `linearRampToValueAtTime` 实装（L190-192）；无测试。**P1** |
| FR-037 波形绘制 | 🟡 | `WaveformCanvas.tsx` 已实现；无测试。**P1** |

### 6.7 导出（FR-038 ~ FR-045）

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-038 导出设置 | ✅ | `exportPlan.test.ts` 4 用例；非法组合检测 `errors + suggestions` |
| FR-039 WebCodecs 主路径 | 🟡 | `webCodecsExporter.ts` 完整实现（Muxer/VideoEncoder/AudioEncoder）；**零测试** → **BUG-04** |
| FR-040 MediaRecorder 兜底 | 🟡 | `mediaRecorderExporter.ts` 137 行已实现；降级切换逻辑无测试 → **BUG-04** |
| FR-041 导出编排 | 🟡 | `exportController.ts` 已实现；无测试 → **BUG-04** |
| FR-042 进度/取消/历史 | 🟡 | `MAX_EXPORT_HISTORY = 10` + 裁剪逻辑存在；无测试 → **BUG-04** |
| FR-043 音频独立导出 | 🟡 | `audioExporter.ts` 自研 WAV 编码 + MP3 降级说明；无测试 → **BUG-04** |
| FR-044 能力探测 | ✅ | `capabilityProbe.test.ts` 4 用例（H.264/HEVC/VP9/AV1/AAC/Opus 矩阵） |
| FR-045 GIF 导出 | ❌ | **P2，PRD 明确延后** ✅ 符合预期 |

### 6.8 AI Provider（FR-046 ~ FR-051）— 本期交付骨架

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-046 AIProvider 接口 + 能力清单 | 🔷 | `AI_CAPABILITIES` 七能力（asr/tts/audioSeparation/audioDenoise/objectRemoval/videoToVideo/caption）+ `AI_CAPABILITY_LABELS`；`docs/ai/provider-api.md`（4633 B）✅ |
| FR-047 注册表与路由 | 🔷 | `router.ts` 5 处 `ProviderNotConfiguredError`（L55/61/66/85/100）✅ 不静默失败 |
| FR-048 Provider 配置持久化 | 🔷 | `config.ts` + `maskApiKey()`；`ProviderSettingsTab.tsx` 掩码 UI |
| FR-049 三个空实现 Provider | 🔷 | `localHttp.ts` / `cloudApi.ts` / `onnxWeb.ts` 各 3 处 `ProviderNotImplementedError` ✅ 含 V1.5 提示 |
| FR-050 端侧静音检测 | ❌ | 全库 `silence` 零命中。**P1**，TASKS 附录记为 V1.0 不做 ✅ 符合约定 |
| FR-051 真实 AI 能力 | ❌ | **P2 明确延后** ✅ |

> **独立确认：AI Provider 确实只有骨架，完全符合 PRD §0 与 §3.8 的约定**（"本期只出接口与占位，不出可用功能"）。FR-046~FR-049 的四项验收标准（类型完整 / 有 `.d.ts` / 抛 `NotImplementedError` / 零厂商 SDK）均已实测满足。

### 6.9 MCP Server（FR-052 ~ FR-056）— 本期交付设计骨架

**独立实测：真实启动 stdio Server 并交互**

```
$ node dist/index.js   （stdin 注入 JSON-RPC）
[mcp] 协议版本 1.0.0
[mcp] 通道 host 已启动：ws://127.0.0.1:8765
[mcp] MCP Server 已启动（stdio），15 个工具已注册。
→ initialize 响应正常：{"protocolVersion":"2024-11-05","serverInfo":{"name":"clipcut-mcp-server","version":"1.0.0"}}
→ tools/list 返回 15 个工具，每个含完整 inputSchema（枚举/required/约束齐全）
→ tools/call project.get_info → 结构化 "not implemented in v1.0" 错误
→ tools/call timeline.add_clip → 结构化 "not implemented in v1.0" 错误
→ 随后 tools/list 仍正常响应（id:4）→ 进程未崩溃 ✅
```

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-052 独立仓库骨架 + stdio | 🔷 | **实测可启动**，响应 `initialize` + `tools/list`（15 工具）；`bin: clipcut-mcp-server`；`README.md` |
| FR-053 工具集设计 + 空实现 | 🔷 | 15 工具 schema + handler 统一返回 `NOT_IMPLEMENTED`，**实测不崩进程** ✅ |
| FR-054 通道设计文档 | 🔷 | `channel/wsServer.ts`（Node host，localhost:8765）+ `channel/codec.ts` + `bridge/clipcutBridge.ts`（`CHANNEL_DISCONNECTED`）；`docs/mcp/channel-protocol.md`（5470 B）✅ |
| FR-055 应用侧 MCP 客户端 | ❌ | 设置面板无 MCP Server 配置项。**P1**，TASKS 记为本期不做 ✅ |
| FR-056 工具完整实现 | ❌ | **P2 明确延后** ✅ |

> **独立确认：MCP Server 确实只有骨架，且骨架质量高于"仅接口定义"——实测可运行、可交互、不崩溃**，完全符合 PRD 约定。`packages/app` 不依赖 `mcp-server`（grep 零命中），包边界干净 ✅

### 6.10 平台抽象与设置（FR-057 ~ FR-062）

| FR | 状态 | 证据 / 备注 |
|---|---|---|
| FR-057 PlatformBridge 抽象 | ✅ | `PlatformBridge.ts` + `WebPlatformBridge.ts`（readFile 优先 FS Access API，降级 `<input type=file>`）；`fileTypes.test.ts` 5 用例；**规则 A 实测零越界** |
| FR-058 设置面板 + i18n | ✅ | `zh-CN.ts` / `en-US.ts` **各 249 词条、条数一致**；`i18n.test.ts` 4 用例（含覆盖率检查） |
| FR-059 撤销/重做 ≥50 步 | ✅ | `HISTORY_LIMIT = 100`；`history.test.ts` **60 次编辑→60 次撤销→深比较全等**；保存后 reset ✅ |
| FR-060 浏览器兼容矩阵 | 🟡 | `CapabilitiesTab.tsx` + `capabilities.ts` 已实现；无测试。**P1** |
| FR-061 代理文件 Proxy | ❌ | `proxyBlobKey` 仅作为字段占位（全为 null），无生成逻辑。**P1** ✅ 符合约定 |
| FR-062 国际化 | ✅ | 自研轻量 i18n 落地（`i18n/index.ts`）；PRD 定义为 P2 ✅ 超额 |

### 6.11 统计汇总

| 分类 | 数量 | 说明 |
|---|---|---|
| ✅ 已实现且有自动化测试 | **20** | 领域核心 + 存储基础 + 渲染 + 能力探测 |
| 🟡 已实现但**无**自动化测试 | **17** | 主要集中在 services（音频/导出/自动保存）与 UI 组件层 |
| 🔷 仅骨架（**符合 PRD 约定**） | **8** | AI Provider 4 条 + MCP 3 条 |
| ❌ 缺失 | **10** | 其中 **9 条为 P1/P2**（PRD 允许延后）；**FR-012 为 P1 但 T14 声称覆盖，实际未实现** |
| **合计** | **47 条 P0 + P1/P2 抽查** | P0 中仅 **1 条存在实质缺陷（BUG-01 逻辑矛盾）** |

**关键结论**：**47 条 P0 中，FR-001~FR-061 的领域与存储主干均已落地**，无"空壳占位"；交付质量的核心风险不在"功能没写"，而在**自动化测试覆盖的广度**（services 层与 UI 层几乎裸奔，BUG-02/03/04）与**一处领域逻辑自相矛盾**（BUG-01）。

---

## 7. 附加验证：构建产物静态性（PRD C1 / §8.7）

| 检查项 | 实测结果 |
|---|---|
| 产物文件清单 | `index.html` + `favicon.svg` + `manifest.webmanifest` + `assets/{index,editor,vendor}.js` + `index.css` ✅ 纯静态 |
| 是否含服务端入口 | `find dist -name '*.server.js'` → 无 ✅ |
| 是否含外部域名 fetch | `grep -roE "fetch\(['\"]https?://"` → **无命中** ✅ |
| 是否含 ws:// 端点 | 无命中 ✅ |
| CI 静态性校验步骤 | `.github/workflows/ci.yml` L49-60 已配置上述 grep 断言 ✅ |
| CI e2e | L74-91 独立 job，`playwright install chromium` + 跑 `smoke.spec.ts` ✅ 已接线 |

---

## 8. 遗留问题与建议（不阻塞发布）

1. **BUG-01 修复后需回归**：工程师修复 `fixClipDuration` 后，`invariants.test.ts` L79 断言需同步调整，并建议补一条"短 clip 高倍速"回归用例。
2. **services 层测试补齐优先级建议**：BUG-04（导出管线）> BUG-03（音频总线）> BUG-02（自动保存）。导出与音频是 P0 验收中"性能门槛"（§8.5）与"音画同步 ≤40ms"（FR-039②）的唯一自动化抓手。
3. **UI 层（components 59 个文件）零测试**：T13~T18 的验收标准大量为交互性描述（"防抖 200ms""F2 重命名""拖拽 ≥60fps"），建议至少对 `i18n`、`hotkeys`、`MediaToolbar` 防抖这三类可单测的纯逻辑补测试，其余依赖 e2e。
4. **性能门槛（§8.5）无自动化验证**：预览 ≥30fps、导出 ≤30s、拖拽 ≥60fps 三项均为手工指标，`vitest.workspace.ts` 亦未配置 `bench`。建议在 README 中明确标注为"需人工验证"，避免被误读为已通过。
5. **清理 `vitest.workspace.ts`**（BUG-06/07）：二选一——接线到 `pnpm test` 聚合脚本，或删除以免误导。

---

## 9. 最终判定

| 判定项 | 结果 |
|---|---|
| 验证命令 | **5/5 通过** |
| 测试用例 | **136/136 通过（100%）** |
| domain 行覆盖率 | **93.13%**（≥80% 门槛） |
| 架构三硬约束 | **全部实测通过**（含产物层双向验证） |
| 变异测试 | **5/5 全部被捕获** — 单测真实有效，非空跑 |
| 工程师自述修复 | **验证通过** — `fillMissing` 修复正确，回归测试真实有效 |
| 源码缺陷 | **1 个（阻塞）** — BUG-01 不变式自相矛盾 |
| 测试盲区 | **6 项**（BUG-02~05 + UI 层） |
| 其他问题 | **2 项次要**（BUG-06/07） |

# 🚦 智能路由判定：`Engineer`

**需工程师修复**：**BUG-01（阻塞）** — `packages/app/src/domain/timeline/invariants.ts` 的 `fixClipDuration` 与 PRD §4.1 时长不变式及同文件 `assertClipInvariants` 自相矛盾，可经公开 API `setClipSpeed` 复现，产出违反硬不变式的工程数据（详见 §4.1，含完整复现代码与实测输出）。

**建议同期处理**：BUG-06（`vitest.workspace.ts` 的 `mkdirSync` 未 import，导致 typecheck/lint 双双漏过）。

其余 BUG-02~05（测试盲区）与 BUG-07 建议排入下一轮，不阻塞 V1.0 发布决策。

---
---

# 第二轮复核报告（BUG-01 / BUG-06 修复验证）

> 复核人：严过关（Yan）· QA Engineer　|　复核日期：2026-10-23
> 触发：工程师修复 BUG-01 与 BUG-06，声称五门禁全绿、test 141 passed
> 复核原则：**不看自述，只看实测**；对每项修复做**变异测试**验证防线真伪

## R2.0 总结论

| 复核对象 | 判定 |
|---|---|
| **BUG-01**（时长不变式自相矛盾） | **✅ FIXED** —— 修复真实有效，防线经变异测试确认为真 |
| **BUG-06**（`vitest.workspace.ts` `mkdirSync` 未 import） | **✅ FIXED** —— 且根因挖掘比报告更深一层，typecheck 兜底已生效 |
| BUG-02~05 | ⏸ **仍在**（测试盲区，本轮未修，符合预期） |
| BUG-07 | ✅ **已解决**（`test:workspace` 已接线） |
| **新发现问题** | **1 个次要** —— `splitClip` 新增的 100ms 校验超出 PRD FR-018① 字面要求（**已于第三轮由 PM 裁定为「方案 1：维持 100ms」，本项转为「已确认 · 符合规格」**，见 T3.8） |

### 🚦 第二轮智能路由判定：`NoOne`

> 上一轮判定为 `Engineer`，工程师已修复全部阻塞项并通过独立验证，本轮**无阻塞/重要缺陷遗留**。
> 唯一新增的 `splitClip` 行为变化经分析**技术上必要**（移除该校验会产出违反不变式的 clip），且不违反 PRD §4.1 硬不变式，故判定为**设计决策待产品确认**而非源码缺陷，不构成路由理由。

---

## R2.1 五门禁复测（实测）

### 重要：本机环境问题已定位并绕过

第一轮我报告过的 `pnpm test:coverage` / `pnpm test` 挂起问题，本轮**已定位到确切根因**：Vitest 2 在写 `web/40b9f1f...` 缓存时会落到**系统临时目录** `C:\Users\renji\AppData\Local\Temp\`，而本机沙箱对该目录写入受限（`EPERM`），导致 **worker 崩溃 → 整个测试文件被静默丢弃 → 退出码 1**。

**证据（三次运行，每次丢弃的文件都不同，证明是随机崩溃而非逻辑失败）**：

| 运行 | 退出码 | 实际跑到 | 被丢弃的文件 |
|---|---|---|---|
| 第 1 次 | **1** | 19 文件 / 117 用例 | `operations-extra.test.ts`（17 用例） |
| 第 2 次 | **1** | 18 文件 / 107 用例 | `invariants.test.ts` + `operations.test.ts` + `i18n.test.ts` |
| 第 3 次（`TEMP` 指向项目内） | **0** | **20 文件 / 134 用例** | 无 |

**绕过方式**：`TEMP/TMP/TMPDIR` 指向项目内目录后，**20 个测试文件全部跑到，134 + 7 = 141 用例，与工程师自述完全一致**。

> ⚠️ 顺带发现：工程师在 `vitest.workspace.ts` 中**删除了原版的 `redirectTempDir()`**（那段把 TEMP 指向项目内的逻辑）。该函数因 `mkdirSync` 未 import 本就静默失效，删除后行为无变化，但**也意味着项目失去了这个环境兜底能力**。建议恢复为可用实现（见 R2.5 建议 1）。

### 门禁结果

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `pnpm lint` | **0** | 零 error 零 warning |
| 2 | `pnpm typecheck` | **0** | 四包 `tsc --noEmit` Done **+ `tsconfig.configs.json` 兜底生效** |
| 3 | `pnpm test` | **0** | app `Test Files 20 passed (20)` / `Tests 134 passed (134)`；shared-types `1 passed` / `7 passed` → **合计 141** ✅ 与自述一致 |
| 4 | `pnpm build` | **0** | 4 包 Done，`✓ built in 13.33s` |
| 5 | `pnpm schema:check` | **0** | 5 用例通过 |

**测试通过率 141/141（100%）** ✅

### domain 覆盖率（实测）

```
All files        |   90.93 |    68.18 |   90.26 |   90.93 |   ← 本次为 19 文件口径
  invariants.ts  |   94.82 |    95.45 |   88.88 |   94.82 |   ← 新增代码后仍高覆盖
  operations.ts  |   86.94 |    68.15 |      90 |   86.94 |
  validation.ts  |   69.35 |       50 |      50 |   69.35 |   ← BUG-05 仍在
```
> 注：本次因环境 EPERM 掉了 1 个测试文件（`operations-extra.test.ts`），导致 `operations.ts` 覆盖率读数偏低；在 TEMP 修正后的完整运行下应回到 93% 左右。**阈值（80/80/75/60）全部满足**。

---

## R2.2 BUG-01 复核：**FIXED** ✅

### 修复前后对比

| 项 | 修复前（第一轮实测） | 修复后（本轮实测） |
|---|---|---|
| `fixClipDuration` | `Math.max(raw, MIN_CLIP_DURATION_MS)` ← 钳制 | `expectedDurationMs(clip)` ← 忠实按公式 |
| 公式来源 | fix 与 assert 各自实现 | **单一函数 `expectedDurationMs`**，二者共用 |
| 原复现路径 `setClipSpeed(clip,10)` | 静默产出 `durationMs=100`（公式期望 50）→ **矛盾数据** | **抛 `InvalidOperationError`**：`变速到 10x 后时长将不足 100ms（源区间 500ms，10x 时需 ≥ 1000ms）` ✅ |
| 最小时长约束位置 | 藏在重算函数里（污染不变式） | 上移到 4 个操作入口（约束**源区间**而非结果时长） |

### 验证点 1：原复现路径重跑 —— ✅ 通过

```
>>> setClipSpeed(10) 抛错 = InvalidOperationError: 变速到 10x 后时长将不足 100ms（源区间 500ms，10x 时需 ≥ 1000ms）
```
**抛错而非产出矛盾数据**，且错误信息包含诊断所需的源区间与所需跨度。✅

### 验证点 2：一致性契约测试真有效性（变异测试）—— ✅ 防线为真

**方法**：把 `Math.max(...)` 钳制**重新加回** `fixClipDuration`，看契约测试是否会失败。

```ts
// 注入的变异
return { ...clip, durationMs: Math.max(expectedDurationMs(clip), MIN_CLIP_DURATION_MS) };
```

**实测结果**：
```
exit=1
     → expected 100 to be 10   // Object.is equality
     → expected 100 to be 67   // Object.is equality
     → expected 100 to be 50   // Object.is equality
 FAIL |app| src/domain/timeline/__tests__/invariants.test.ts
   > fixClipDuration 忠实按公式重算，**不做任何钳制**
 FAIL |app| src/domain/timeline/__tests__/invariants.test.ts
   > 对任意合法 clip，fix 之后 assert 必然通过
 FAIL |app| src/domain/timeline/__tests__/invariants.test.ts
   > QA BUG-01 复现场景：setClipSpeed 目标态不再自相矛盾
 Test Files  1 failed (1)
```

**3 个测试同时失败** → 这道防线**是真的**，不是摆设。✅
（其中第 2 个是**契约测试**：7 种速度 × 6 种跨度 = **42 组组合**全覆盖，与工程师自述的"42 组"完全吻合。）

### 验证点 3：`minSourceSpanMs` 低速是否被误钳 —— ✅ 正确，未误钳

实测全速度档位：

| speed | `minSourceSpanMs(speed)` | 对应时间线时长 | 是否正确 |
|---|---|---|---|
| 0.1 | **10** | 100.0ms | ✅ |
| 0.25 | **25** | 100.0ms | ✅ |
| 0.5 | **50** | 100.0ms | ✅ |
| 0.75 | **75** | 100.0ms | ✅ |
| 1 | 100 | 100.0ms | ✅ |
| 1.5 | 150 | 100.0ms | ✅ |
| 2 | 200 | 100.0ms | ✅ |
| 4 | 400 | 100.0ms | ✅ |
| 10 | **1000** | 100.0ms | ✅ |

**关键确认**：
- `speed=0.5` → 返回 **50**（不是 100）✅ **低速未被误钳**
- `speed=0.1` → 返回 **10** ✅
- 全部档位满足 `minSourceSpanMs(speed) / speed == 100.0000` → **反解公式完全正确**
- 非法输入（0 / NaN）退化为 1 → 返回 100 ✅

**低速变速实测**：`setClipSpeed(clip, 0.5)`（源区间 1000ms）→ `durationMs=2000`，与公式期望 2000 一致 ✅ **低速路径完全正常**。

### 验证点 4：四个入口钳制未引入新缺陷 —— ✅ 基本无缺陷

| 入口 | 实测行为 | 判定 |
|---|---|---|
| `setClipSpeed` | 变速到时长 < 100ms → 抛 `InvalidOperationError` | ✅ 正确 |
| `addClip` | 素材本身过短（50ms）→ 抛 `InvalidOperationError: 素材过短：v.mp4 仅 50ms，无法满足 100ms 源区间要求（speed=1）` | ✅ 正确 |
| `trimClip` | 源区间跨度不足 → 抛 `InvalidOperationError` | ✅ 正确 |
| `splitClip` | 两侧任一 < 100ms → 抛 `NotSplittableError` | ✅ **符合规格**（PM 第三轮裁定方案 1 维持 100ms，见 T3.8） |

**`splitClip` 两侧不变式正确性实测**（speed=2 的 clip 在 200ms 处分割）：
```
>>> clip: in=0 out=400 dur=200 speed=2 期望=200 一致=true
>>> clip: in=400 out=2000 dur=800 speed=2 期望=800 一致=true
```
✅ **变速 clip 的分割后，源区间按 `speed` 正确切分，两侧不变式均成立**。

### 验证点 5：其余既有测试期望值未被改动 —— ✅ 确认

按文件 mtime 核查，**本轮仅 `invariants.test.ts` 一个测试文件被修改**（07:19），其余 20 个测试文件 mtime 均为 01:57~03:25（第一轮之前）：

```
2026-10-23 07:19  packages/app/src/domain/timeline/__tests__/invariants.test.ts   ← 唯一被改
2026-10-23 03:25  packages/app/src/domain/project/__tests__/unknownFields.test.ts
2026-10-23 03:01  packages/app/src/domain/timeline/__tests__/operations-extra.test.ts
2026-10-23 02:35  packages/app/src/domain/timeline/__tests__/operations.test.ts
...（其余 17 个均未变）
```

**被改的那 1 处期望值已核对无误**：
```ts
// 修复前：expect(fixClipDuration(makeClip({ speed: 100 })).durationMs).toBe(MIN_CLIP_DURATION_MS);  // 100
// 修复后：expect(fixClipDuration(makeClip({ speed: 100 })).durationMs).toBe(10);                    // 1000/100 = 10 ✅ 与公式一致
```
✅ **语义正确**：既然 `fix` 忠实按公式重算，1000ms 源区间 @ 100x 必然是 10ms。工程师改的是**测试的期望值以匹配正确的公式**，而非为了让测试通过而放松断言 —— 且新期望值仍被变异测试证明有效（MUT 中 `expected 100 to be 10` 即该行触发）。

---

## R2.3 新发现：`splitClip` 行为变化（**次要 · 待确认设计决策，非缺陷**）

**文件**：`packages/app/src/domain/timeline/operations.ts` L482-487（新增）

```ts
// 分割后两侧都必须满足最小时长，否则会产出违规 clip。
if (leftDuration < MIN_CLIP_DURATION_MS || rightDuration < MIN_CLIP_DURATION_MS) {
  throw new NotSplittableError(
    `分割后任一侧时长不足 ${MIN_CLIP_DURATION_MS}ms（左 ${leftDuration}ms / 右 ${rightDuration}ms）`,
  );
}
```

### 问题：超出 PRD FR-018① 的字面要求

**PRD FR-018① 原文**：
> ① 分割点在 clip 首尾 **1 帧内**时提示不可分割

PRD **只**规定了"1 帧内不可分割"，**未规定**两侧必须各 ≥ 100ms。30fps 下 1 帧 = 33.3ms。

### 实测扫描（2000ms clip，从头逐点扫描）

| 分割点 | 实测结果 | PRD 判定（距首尾 > 1 帧 → 应允许） |
|---|---|---|
| 20ms | 拒绝（距首尾不足 1 帧） | 应拒绝 ✅ 一致 |
| **34ms** | **拒绝（任一侧时长不足 100ms）** | **应允许 ❌ 超出 PRD** |
| **50ms** | **拒绝** | **应允许 ❌** |
| **80ms** | **拒绝** | **应允许 ❌** |
| **99ms** | **拒绝** | **应允许 ❌** |
| 100ms | 允许 | 应允许 ✅ |
| 150ms | 允许 | 应允许 ✅ |

**结论**：在 33.3ms ~ 100ms 区间，**PRD 允许的分割点被拒绝**（约 66.7ms 的"死区"）。

### 但：从技术一致性看该校验是**必要**的

我用变异测试验证了"移除该校验会怎样"：

```ts
// 变异：if (leftDuration < MIN_CLIP_DURATION_MS || rightDuration < MIN_CLIP_DURATION_MS) → if (false)
>>> clip dur=50  → assert 抛错: 小于最小 clip 时长：50 < 100
>>> clip dur=1950 → assert 通过
```

**若移除该校验**，`splitClip` 在 50ms 处分割会产出 `durationMs=50` 的 clip，而 `assertClipInvariants` 对它**必然抛错**（50 < 100）—— 即**又造出了"违反自身不变式的数据"**，正是 BUG-01 的同类问题。

因此该校验的作用是：**把"不可分割"从"事后 assert 抛错"前移为"入口显式拒绝"**，与 `setClipSpeed` / `addClip` / `trimClip` 的处理方式完全一致。

### 判定：**待确认的产品设计决策，不作为缺陷路由**

| 维度 | 评估 |
|---|---|
| 是否违反 PRD §4.1 硬不变式 | ❌ 不违反（反而是保障） |
| 是否与 BUG-01 同类 | ❌ 不同类（BUG-01 是产出矛盾数据；此处是显式拒绝） |
| 是否阻断发布 | ❌ 否（拒绝时有明确错误提示，用户可换分割点） |
| 与专业剪辑软件对比 | ⚠️ **本行原表述有误，已在第三轮更正**（见 T3.8）：剪映/Premiere **并非**允许切出任意非零长度片段，它们**同样设限**，下限是「1 个项目帧」。详见 T3.8 的更正说明 |
| 建议 | **交产品确认**：若产品认为"允许切出 < 100ms 的片段"，则应同时放宽 `assertClipInvariants` 的最小时长分支（否则又会出现 BUG-01 式矛盾）；若维持现状，建议在 PRD FR-018① 补一句"两侧均需 ≥ 100ms"，消除文档与实现的差异 |

**严重级别：次要**　**复现方式**：`splitClip(ctx, clipId, 50)`（clip 起点 50ms 内）→ 抛 `NotSplittableError`
**建议处理**：产品确认后补文档，或在实现注释中标注该约束来源。

> ✅ **第三轮闭环**：PM 已裁定**方案 1（维持 100ms）**，并已落盘 `docs/PRD.md` §9.1 D-001（含 FR-018① 两级规则修正 + 新增 FR-018④ P0 可操作提示要求）。本项从「待确认」转为 **「已确认 · 符合规格」**。详见 T3.8。

---

## R2.4 BUG-06 复核：**FIXED** ✅（且根因挖掘更深）

### 修复内容核实

| 工程师声明 | 实测核实 | 判定 |
|---|---|---|
| 补了 `mkdirSync` import | **未补**——但改为**整段删除 `redirectTempDir()`** | ✅ 等效（见下） |
| 根因是 coverage 块在 Vitest 2 里非法（workspace 根级选项不能写在 project 的 `test` 内） | **已核实**：新版 `vitest.workspace.ts` 已移除 `coverage` 块，并在文件头注明"coverage 是 workspace 根级选项，不能写在单个 project 的 test 里" | ✅ 根因准确 |
| 新增 `tsconfig.configs.json` 纳入 typecheck 兜底 | 存在，`include: ["vitest.workspace.ts"]`；根 `package.json` typecheck 脚本末尾追加 `&& tsc -p tsconfig.configs.json --noEmit` | ✅ 已接线 |
| 新增 `pnpm test:workspace` | `"test:workspace": "vitest run --workspace ."` | ✅ 已接线 |
| 注明真正生效阈值在 `packages/app/vitest.config.ts` | 已核实：该文件确有 `thresholds: { lines: 80, statements: 80, functions: 75, branches: 60 }` | ✅ 属实 |

> **关于"补 import"与"整段删除"的差异**：原 `redirectTempDir()` 唯一作用是把 TEMP 指向项目内，但它因 `mkdirSync` 未 import 而**从未生效**。删除整段 = 移除一个死代码，**行为等价**，且更干净。这比"补 import 让它开始生效"更稳妥（后者会让所有 `vitest run --workspace` 都强制改写 TEMP，可能影响其他工具）。

### 验证点 1：故意写 ReferenceError，typecheck 能否拦住 —— ✅ 能

**变异**：在 `vitest.workspace.ts` 中插入 `const undefinedRef = someUndeclaredVariableXYZ;`

```
TYPECHECK EXIT=2
vitest.workspace.ts(30,22): error TS2304: Cannot find name 'someUndeclaredVariableXYZ'.
```

✅ **新配置真实生效**。第一轮 BUG-06 的核心问题（"该文件未被任何 tsconfig include，typecheck 与 lint 双双漏过"）**已彻底解决**。

### 验证点 2：coverage 阈值现在是否真实生效 —— ✅ 真实生效（关键验证）

**变异**：把 `packages/app/vitest.config.ts` 的 `lines: 80` 改为 `lines: 99`

```
ERROR: Coverage for lines (30.4%) does not meet global threshold (99%)
ERROR: Coverage for statements (30.4%) does not meet global threshold (80%)
ERROR: Coverage for branches (58.75%) does not meet global threshold (60%)
EXIT=1   ← 阈值真实拦截，进程失败
```

✅ **此前"阈值静默失效"的问题已修复**：现在覆盖��不足会**硬失败并返回非 0 退出码**，CI 门禁可依赖。

> 补充说明：全量 `pnpm test:coverage` 在本机仍会因同一 EPERM 环境问题挂起（与 R2.1 同源），故本次用限定 `include` 的等价方式验证阈值拦截行为，**验证的是同一个配置项与同一条拦截路径**，结论有效。

### 验证点 3：`tsconfig.configs.json` 确实被引用 —— ✅

```json
"typecheck": "pnpm --filter @clipcut/shared-types build && pnpm -r typecheck && tsc -p tsconfig.configs.json --noEmit"
```
✅ 根 `typecheck` 脚本末尾显式引用，且实测 `pnpm typecheck` 退出码 0。

---

## R2.5 第一轮其他缺陷状态复核

| 编号 | 严重级别 | 状态 | 核查方式 |
|---|---|---|---|
| BUG-01 | 阻塞 | ✅ **已修复** | R2.2 变异测试 + 行为复现 |
| BUG-02 | 重要 | ⏸ **仍在** | `services/storage/__tests__/` 仍只有 `projectRepo.test.ts`，无 `autoSave.test.ts` |
| BUG-03 | 重要 | ⏸ **仍在** | `services/media/__tests__/` 仍只有 `metadataProbe.test.ts`，音频引擎/worklet 零测试 |
| BUG-04 | 重要 | ⏸ **仍在** | `services/export/__tests__/` 仍只有 `capabilityProbe.test.ts`，导出管线零测试 |
| BUG-05 | 次要 | ⏸ **仍在** | `validation.ts` 覆盖率实测 69.35% / 分支 50% / 函数 50%，与第一轮一致 |
| BUG-06 | 次要 | ✅ **已修复** | R2.4 变异测试 |
| BUG-07 | 次要 | ✅ **已解决** | 新增 `test:workspace` script，`vitest.workspace.ts` 已有实际引用方 |

### 附带发现（次要）

**`ClipConstraintError` 是死代码**：定义了但**全项目零使用**，也未从 `domain/timeline/index.ts` 导出。四个入口实际抛的都是既有的 `InvalidOperationError` / `NotSplittableError`。
- **位置**：`packages/app/src/domain/timeline/invariants.ts` L49-54
- **严重级别**：次要（无害，但增加认知负担；且 `invariants.ts` 覆盖率因此从 100% 降到 94.82%，未覆盖行正是 L51-53）
- **建议**：删除该类，或改为真正使用它（入口准入失败用专属错误类型语义更清晰）

**新 API 未从 `index.ts` 导出**：`expectedDurationMs` / `minSourceSpanMs` / `isSpanLongEnough` / `assertFixSatisfiesAssert` 均未在 `domain/timeline/index.ts` 的导出列表中。当前仅测试文件通过 `../invariants.js` 直接路径引用，功能正常，但**公共 API 面不完整**，外部调用方（如未来 MCP server）无法从包入口使用。
- **严重级别**：次要
- **建议**：补进 `index.ts` 导出列表

---

## R2.6 本轮 QA 侧操作说明（源码完整性）

本轮共对 **4 个源文件**做了临时变异，**全部已还原并逐一 grep 校验**：

| 文件 | 变异内容 | 还原校验 |
|---|---|---|
| `domain/timeline/invariants.ts` | 把 `Math.max` 钳制加回 `fixClipDuration` | ✅ `durationMs: expectedDurationMs(clip)` 计数 = 1 |
| `vitest.workspace.ts` | 插入 `someUndeclaredVariableXYZ` | ✅ 计数 = 0 |
| `packages/app/vitest.config.ts` | `lines: 80` → `lines: 99` | ✅ `lines: 80` 计数 = 1 |
| `domain/timeline/operations.ts` | 移除 `splitClip` 两侧最小时长校验 | ✅ `leftDuration < MIN_CLIP_DURATION_MS` 计数 = 1 |

另创建过 5 个临时探针测试文件（`probe_r2.test.ts` / `probe_r2b.test.ts` / `probe_split.test.ts` / `probe_edge.test.ts` / `probe_neg.test.ts` / `probe_split2.test.ts`），**已全部删除**（`find packages -name "*probe*"` 返回空）。

还原后全门禁复跑：**lint 0 / typecheck 0 / test 0（141 用例）/ build 0 / schema:check 0**。

---

## R2.7 第二轮最终判定

| 判定项 | 结果 |
|---|---|
| 五门禁 | **5/5 通过** |
| 测试用例 | **141/141 通过（100%）** — 与工程师自述完全一致 |
| BUG-01 | ✅ **FIXED**（变异测试证明防线为真） |
| BUG-06 | ✅ **FIXED**（变异测试证明 typecheck 兜底 + 阈值拦截均生效） |
| BUG-02~05 | ⏸ 仍在（测试盲区，非本轮范围） |
| BUG-07 | ✅ 已解决 |
| 新发现问题 | 1 个次要（`splitClip` 100ms 约束超出 PRD 字面要求 —— **待产品确认的设计决策**） |
| 源码完整性 | ✅ 4 个变异文件全部还原并校验，门禁复跑全绿 |

# 🚦 第二轮智能路由判定：`NoOne`

**理由**：工程师已修复第一轮发现的全部阻塞缺陷（BUG-01）与次要缺陷（BUG-06），且修复经**独立变异测试**确认为真实有效（非"看起来改了"）。新增的 `splitClip` 行为变化经技术分析为**保障不变式所必需**，且已具备明确错误提示、不阻断使用，不构成源码缺陷。**无需再次路由给工程师。**

**建议的后续动作（均不阻塞 V1.0 发布）**：
1. **产品确认** `splitClip` 两侧 ≥ 100ms 是否符合预期；若维持，请补入 PRD FR-018① 以消除文档与实现差异（→ 产品经理）
2. **恢复 `redirectTempDir()`** 为可用实现（修好 `mkdirSync` import），避免本机/受限环境下 `pnpm test` 因 EPERM 出现"随机丢测试文件 + 退出码 1"的假象（→ 工程师，低优先级）
3. **补 `services/` 层测试**（BUG-02/03/04），优先级：导出管线 > 音频总线 > 自动保存
4. **删除死代码 `ClipConstraintError`** 或改为实际使用；**把 4 个新 API 补进 `domain/timeline/index.ts` 导出**（→ 工程师，次要）
5. **`validation.ts` 覆盖率提升**（BUG-05，69.35% → 目标 80%）

---

*第二轮复核完*
---

# 第三轮专项复核：导出帧率下限前提（PM 决策一的安全前提验证）

> 复核人：严过关（Yan）· QA Engineer　|　日期：2026-10-23
> 触发：PM 拍板「`splitClip` 维持 100ms 最小片段时长」，其安全论证依赖「100ms 在任何 ≥10fps 的帧率下都 ≥1 帧」这一前提。PM 列为 P1 确认项。
> 复核方式：**只读验证 + 构造性实测**（本轮未修改任何源文件）

## T3.0 结论摘要

| 问题 | 结论 |
|---|---|
| **PM 的 100ms 前提（数学层面）是否成立？** | ✅ **成立**。实测 fps=60/50/30/25/24/10 时，100ms 片段**恒采样 ≥1 帧**；fps≤5 时可被整段丢弃。PM 的数学推理正确 |
| **导出帧率的可选值实际是什么？** | UI 确为 **24/25/30/50/60**（与 FR-038 一致），但**存在两条绕过路径可写入更低的 fps** |
| **是否存在绕过路径？** | ⚠️ **存在，且是真实可触发的漏洞** —— 用户编辑 `.clipcut.json` 写入 `"fps": 5` 后导入，**全程零拦截、零警告**，导出时 100ms 片段**静默消失** |
| **该漏洞是"真实可触发"还是"仅理论风险"？** | **真实可触发**（非理论风险）。完整链路已端到端实测复现，见 T3.3 |
| **第 3 项（`listFiles()` 完整性）** | PM 的三项描述**均属实**（深度上限生效 / 优雅降级成立），但**发现一处 PM 未提及的缺口**：`listFiles()` **无任何 UI 调用方**；另存在**无文件数量上限**的问题 |

---

## T3.1 验证点 1：导出帧率的可选值（实际代码实测）

### UI 路径 —— 与 FR-038 完全一致 ✅

`packages/app/src/components/inspector/ExportSection.tsx` L115：
```tsx
options={[24, 25, 30, 50, 60].map((fps) => ({ value: String(fps), label: `${fps}` }))}
```
✅ 与 PRD FR-038「帧率（24/25/30/50/60）」**完全一致**，无遗漏更低值。UI 为 Radix `Select` 只能从 options 中选，**正常 UI 操作无法写入 fps < 24**。

### 领域层 —— 只有上限，没有下限 ⚠️

`packages/app/src/domain/export/exportPlan.ts` L72、L94-97：
```ts
const fps = Math.max(1, Math.round(input.fps));   // ← 下限是 1，不是 10
...
if (fps > MAX_EXPORT_FPS) {                        // ← 只有上限 60 的检查
  errors.push(`帧率 ${fps} 超过导出支持的上限 ${MAX_EXPORT_FPS}。`);
  suggestions.push('降至 30fps');
}
```
`MAX_EXPORT_FPS = 60` 存在，但**没有对应的 `MIN_EXPORT_FPS`**。`fps=5` 时 `errors` 为**空数组**（实测，见 T3.3）。

### Schema 层 —— 允许 fps=1 ⚠️

`schema/project.schema.json` L80、L104：
```json
"fps": { "type": "number", "minimum": 1, "maximum": 240 }
```
`canvas.fps` 与 `export.fps` **两处**都是 `minimum: 1`。JSON Schema 是 `deserialize` 的校验依据（L150 `validateProjectDoc(migrated)`），因此**任何 ≥1 的 fps 都能通过 Schema 校验**。

### 状态层 —— 无钳制 ⚠️

`packages/app/src/domain/timeline/operations.ts` L931-936：
```ts
export function setExportSettings(ctx: OperationContext, patch: Partial<ExportSettings>): OperationResult {
  const result = run(ctx.doc, (draft) => {
    Object.assign(draft.settings.export, patch);   // ← 直接赋值，无 fps 校验
  });
```
对比同文件的 `setClipProperty` 有 `NUMERIC_RANGES` 白名单 + 钳制，**`setExportSettings` 对 fps 完全没有校验**。

### 绕过路径汇总

| # | 路径 | 可写入的 fps | 触发难度 | 实测结果 |
|---|---|---|---|---|
| 1 | UI `Select` | 仅 24/25/30/50/60 | — | ✅ 安全 |
| 2 | **编辑 `.clipcut.json` 的 `settings.export.fps` 后导入** | **任意 ≥1** | **低**（文本编辑器改一个数字） | ❌ **完全无拦截** |
| 3 | **编辑 `.clipcut.json` 的 `settings.canvas.fps` 后导入** | **任意 ≥1** | **低** | ❌ **完全无拦截**（影响 `splitClip` 的 `frameMs`） |
| 4 | `setExportSettings({fps})` | 任意 | 需内部调用 | ❌ 无钳制 |

> **注意路径 3 的额外影响**：`operations.ts` L465 `const fps = ctx.doc.settings.canvas.fps || 30;` 决定 `splitClip` 的"1 帧"判定。`canvas.fps=1` 时 1 帧 = 1000ms，`splitClip` 将拒绝距首尾 1000ms 内的所有分割点 —— 属于另一个方向的滥用。

---

## T3.2 验证点 2：反序列化路径是否拒绝低 fps —— 实测**不拒绝**

### 实测输出（构造性用例，已删除）

```
>>> 导入 export.fps=5 : ✅ 接受（未被拒绝）
>>> 落地值: settings.export.fps = 5
>>> 导入 canvas.fps=1 : ✅ 接受（未被拒绝）
>>> 落地值: settings.canvas.fps = 1
>>> buildExportPlan(fps=5): fps=5 frameDurationMs=200.00 totalFrames=25
>>> errors = []
>>> suggestions = []
>>> 是否报出「帧率过低」错误? ❌ 否（无任何提示）
>>> buildExportPlan(fps=1): frameDurationMs=1000 totalFrames=5 errors=[]
```

**三处防线全部失守**：
1. `deserialize` → **接受**（Schema `minimum: 1` 放行；`validation.ts` 中 grep `fps` **零命中**，即无任何 fps 专项校验）
2. `buildExportPlan` → **接受**（下限 `Math.max(1, ...)`，且不产生任何 error）
3. UI `Select` → `value={String(exportSettings.fps)}` = `"5"`，**在 options 中找不到匹配项**

> **第 3 点是额外的 UI 隐患**：`value="5"` 不在 `[24,25,30,50,60]` 中，Radix Select 通常会显示**空白或回退到首项**。用户导入一个 fps=5 的工程后，导出面板的帧率下拉框**可能显示为空**，而实际导出会用 5 fps —— UI 显示与实际行为不一致，且用户无从察觉。

---

## T3.3 端到端绕过链复现（证明是**真实可触发**漏洞）

### 完整链路实测输出

```
>>> 步骤2 导入结果: export.fps = 5（未被拒绝、未被钳制）
>>> 步骤3 导出计划: fps=5, frameDurationMs=200, totalFrames=25
>>> 步骤3 errors=[] suggestions=[]
>>> 步骤4 100ms 片段@500ms 在 fps=5 下采样 0 帧
    → 整段在成片中消失，且 errors 为空 = 静默丢帧
```

**复现方式**（任一用户，5 步内）：
1. 用任意文本编辑器打开导出的 `.clipcut.json`
2. 把 `"fps": 30` 改为 `"fps": 5`（`settings.export.fps` 或 `settings.canvas.fps`）
3. 在应用里「导入工程」
4. 导入**成功，无任何提示**（Schema 只要求 ≥1）
5. 点「开始导出」→ 计划面板 `errors` 为空 → 导出完成
6. **结果：时间线上看得见的 100ms 片段，在成片里凭空消失，无任何报错**

### 丢帧机制（代码级确认）

`packages/app/src/services/export/webCodecsExporter.ts` L196-206：
```ts
for (let index = 0; index < totalFrames; index += 1) {
  const timeMs = (index * 1000) / fps;        // ← 帧时刻离散采样
  await renderFrameAsync(ctx, doc, timeMs, options.getFrame);
  const frame = new VideoFrame(canvas, { timestamp: ..., duration: ... });
```
`packages/app/src/render/compositor.ts` L46：
```ts
return timeMs >= clip.startMs && timeMs < clip.startMs + clip.durationMs;  // isActiveAt
```
→ 片段只在**离散帧时刻**被采样。若片段时长 < 帧周期且未跨越任何帧时刻，**该片段在整段导出中一次都不会被渲染**。

### 全帧率实测（100ms 片段，5000ms 工程）

| fps | 帧周期 | 片段@500ms 采样 | 片段@550ms 采样 | 结论 |
|---|---|---|---|---|
| 60 | 16.7ms | 6 帧 | 6 帧 | ✅ 安全 |
| 50 | 20.0ms | 5 帧 | 5 帧 | ✅ 安全 |
| 30 | 33.3ms | 3 帧 | 3 帧 | ✅ 安全 |
| 25 | 40.0ms | 2 帧 | 3 帧 | ✅ 安全 |
| 24 | 41.7ms | 3 帧 | 2 帧 | ✅ 安全 |
| **10** | **100.0ms** | **1 帧** | **1 帧** | ✅ **安全（PM 前提的下边界，成立）** |
| **5** | 200.0ms | **0 帧** | 1 帧 | ❌ **整段消失** |
| **1** | 1000.0ms | **0 帧** | **0 帧** | ❌ **整段消失** |

✅ **PM 的数学前提验证成立**：fps=10 时 100ms 片段恒采样恰好 1 帧（帧周期 = 100ms = 片段时长，边界对齐不丢帧）；fps ≤ 5 时可被整段丢弃。
❌ **但前提的"任何 ≥10fps"缺乏系统保障** —— fps 的下限保护完全缺失。

### 严重级别判定

| 维度 | 评估 |
|---|---|
| 触发难度 | **低** —— 文本编辑器改一个数字，用户完全可控 |
| 是否需要特殊环境 | **否** —— 任何浏览器、任何用户 |
| 后果 | **用户可见的数据丢失**（成片缺内容）**且无任何报错** |
| 是否阻断正常用户 | 否（正常 UI 走不到 fps<24） |
| **定级** | **重要（P1）** —— 非阻塞发布（正常路径不可达），但**是真实可触发的静默数据丢失**，且恰好落在 PM 论证所依赖的那条安全边界上 |

### 与 PM 决策的关系（重要）

PM 维持 100ms 下限的**核心理由**（"放宽会导致导出静默丢帧"）**完全成立**，本轮实测予以确认。
但 PM 论证的前提 ——「帧率恒 ≥10fps」—— **当前不成立**，因为 fps 下限没有任何系统保障。

> ⚠️ **这意味着 PM 的安全论证存在一个缺口**：100ms 这道闸门本身是对的，但**它挡不住绕过闸门的路径**。用户改 JSON 把 fps 调到 5，100ms 的片段照样消失。
>
> **结论不是"PM 决策错了"**，而是：**PM 选的闸门正确，但需要补一道"闸门本身的下限保护"**。两道防线缺一不可：
> - 防线 A（已有）：片段时长 ≥ 100ms —— 防止低帧率下片段过短
> - 防线 B（缺失）：帧率 ≥ 10fps —— 防止帧率本身过低
>
> 只做 A 不做 B，仍然会静默丢帧。

---

## T3.4 修复建议（供工程师参考，QA 不代改）

按"最小改动、最大收益"排序：

**① 在 `buildExportPlan` 增加帧率下限检查（推荐，最高性价比）**
```ts
export const MIN_EXPORT_FPS = 10;   // 与 MIN_CLIP_DURATION_MS 配套
...
if (fps < MIN_EXPORT_FPS) {
  errors.push(`帧率 ${fps} 过低：低于 ${MIN_EXPORT_FPS}fps 时短片段会被导出采样丢弃。`);
  suggestions.push(`升至 ${MIN_EXPORT_FPS}fps`);
}
```
放在 `buildExportPlan` 而非仅 UI，可**一处覆盖全部绕过路径**（因为 UI 和 `exportController` 都必经 `buildExportPlan`）。且 `errors` 非空时导出面板本就会阻止导出 → **用户改 JSON 后会看到明确提示**。

**② 收紧 JSON Schema 的 fps 约束**
```json
"fps": { "type": "number", "minimum": 10, "maximum": 60 }
```
让 `deserialize` 在导入阶段就拒绝低 fps 工程文件（与 `minimum: 1, maximum: 240` 相比更贴合 FR-038）。

**③ `setExportSettings` 增加 fps 钳制**
在 `operations.ts` 的 `setExportSettings` 中对 `patch.fps` 做 `clamp(patch.fps, MIN, MAX)`，与 `setClipProperty` 的 `NUMERIC_RANGES` 机制保持一致。

**④ 补测试**
- `buildExportPlan` 对 `fps=5` 应产生 error（守护 ①）
- `deserialize` 对 `export.fps=5` 应抛 `ValidationError`（守护 ②）
- 契约测试：`MIN_EXPORT_FPS` 与 `MIN_CLIP_DURATION_MS` 的关系 —— `MIN_CLIP_DURATION_MS >= 1000 / MIN_EXPORT_FPS` 恒成立（这正是 PM 论证的形式化表达，可作为回归守护）

**⑤ UI 兜底**
`ExportSection` 的 `Select` 在 `value` 不在 options 中时应回退到最近合法值或显示"当前工程帧率非法"，避免 UI 显示与实际导出行为不一致。

---

## T3.5 连带确认：`listFiles()` 完整性（第 3 项）

PM 的三项描述**逐条核实，全部属实**：

| PM 的描述 | 实测结果 | 判定 |
|---|---|---|
| 实现了 `showDirectoryPicker` | `WebPlatformBridge.listFiles()` L163-181：`picker.call(window, { mode: 'read' })` | ✅ 属实 |
| 递归深度上限 2 | 构造 root/l1/l2/l3 四层链实测：收集到 `["f-l1.txt","f-l2.txt","f-root.txt"]`，**不含 l3** → 深度上限**真实生效** | ✅ 属实 |
| `UnsupportedOperationError` 优雅降级 | 模拟 Firefox（`showDirectoryPicker` 未定义）：抛 `UnsupportedOperationError: 当前浏览器不支持 File System Access API，无法列目录。` —— **不崩溃**，且是可被 UI 捕获的**专属错误类型** | ✅ 属实 |

**额外核实（PM 未提及的两点）**：

**① `listFiles()` 当前没有任何 UI 调用方 —— 能力未接线 ⚠️**
```
grep -rn "listFiles" packages/app/src --include=*.ts --include=*.tsx
  → 仅 platform/PlatformBridge.ts:38（接口声明）
  → 仅 platform/index.ts:31（错误类型导出）
  → 无 components/ / hooks/ / services/ 引用
```
→ PM 说"用户选文件夹导入能力已由 `listFiles()` 覆盖"，从**平台层能力**看成立；但从**用户可达性**看，该能力**当前没有任何入口**，用户无法在 UI 上触发。
→ 这不影响 FR-012 的定性（PM 判定 FR-012 为 P1 而非 P0 是合理的），但**"已覆盖"的措辞建议修正为"平台层已具备能力，UI 入口待接线"**。

**② 无文件数量上限 —— 宽目录有内存/耗时风险 ⚠️**
实测 5000 个文件的目录：**全部读入内存，耗时 5ms，无任何上限保护**。
- 深度上限只限制**目录层级**，**不限制单层文件数**
- `files.push(await fileHandle.getFile())` 会把每个 `File` 对象全部驻留内存
- 极端情况（数万文件的目录，如用户误选 `C:\` 或 `node_modules`）可能导致长时间阻塞主线程或内存膨胀

→ 建议增加文件数上限（如 2000）并在超限时**显式告警**而非静默截断。
→ **严重级别：次要**（该能力当前无 UI 入口，不可触发；接线后需一并处理）

---

## T3.6 本轮 QA 侧操作说明

本轮为**纯只读验证**，**未修改任何源文件**。校验方式：
```
grep -c "Math.max(1, Math.round(input.fps))" packages/app/src/domain/export/exportPlan.ts   → 1
grep -c '"fps": { "type": "number", "minimum": 1, "maximum": 240 }' schema/project.schema.json → 2
```
创建过 6 个临时探针测试文件（`probe_fps.test.ts` / `probe_drop.test.ts` / `probe_e2e.test.ts` / `probe_listfiles.test.ts` / `probe_lf2.test.ts` / `probe_lf3.test.ts`），**已全部删除**（`find packages -name "*probe*"` 返回空）。
门禁复跑：**lint 0 / test 0（141 用例）/ typecheck 0**。

---

## T3.7 第三轮专项结论

| 结论项 | 判定 |
|---|---|
| PM 的 100ms 安全前提（数学） | ✅ **成立**，实测 fps≥10 时 100ms 恒 ≥1 帧 |
| 导出帧率可选值 = 24/25/30/50/60 | ✅ UI 层属实，与 FR-038 一致 |
| **前提的系统保障（fps ≥ 10 恒成立）** | ❌ **不成立** —— fps 下限无任何保护 |
| **绕过路径是否存在** | ⚠️ **存在，且真实可触发**：改 `.clipcut.json` 的 `export.fps` 或 `canvas.fps` 为 5 或 1 → 导入零拦截 → 导出 `errors` 为空 → **100ms 片段在成片中静默消失** |
| 漏洞定级 | **重要（P1）** —— 静默数据丢失，用户可控触发，但正常 UI 路径不可达 |
| **对 PM 决策的影响** | **决策本身正确**（100ms 闸门必要且有效），但**论证前提缺一道防线**。建议补 `MIN_EXPORT_FPS = 10`（领域层）+ Schema `minimum: 10`（导入层），与 100ms 片段下限形成双防线 |
| 第 3 项 `listFiles()` | PM 三项描述**全部属实**；但**无 UI 调用方**（能力未接线）+ **无文件数上限**（次要风险） |
| 修复归属 | **工程师**（新增 `MIN_EXPORT_FPS` + Schema 收紧 + 钳制 + 测试）；**产品经理**（修正 FR-012 措辞："平台层已具备，UI 入口待接线"） |

---

*第三轮专项复核完*
---

# 第四轮：PM 决策回执与 T3.8 事项闭环

> 复核人：严过关（Yan）· QA Engineer　|　日期：2026-10-23
> 触发：PM 拍板 D-001（方案 1：维持 100ms）+ D-002（FR-012 变体裁定），并对 QA 的一处事实表述提出纠正
> 复核方式：**只读核实 + 构造性实测**（本轮未修改任何源文件）

## T3.8.1 R2.3 状态变更：待确认 → **已确认 · 符合规格** ✅

PM 已落盘 `docs/PRD.md` 第 9 章「补充决策记录」：

| 落盘位置 | 内容 | 核实 |
|---|---|---|
| `PRD.md` L103（FR-018 行） | 追加 ③ 引导句 → 指向 §9.1 D-001 | ✅ 已落盘 |
| `PRD.md` L523-590 | §9.1 D-001 完整决策记录 | ✅ 已落盘 |
| `PRD.md` L592-627 | §9.2 D-002 FR-012 范围裁定 | ✅ 已落盘 |
| `PRD.md` L628-640 | §9.3 后续动作表（5 项，含责任方与优先级） | ✅ 已落盘 |
| `PRD.md` L92（FR-012 行） | ② 改为「本期不要求任何实现（含 `LocalFolderConnector`）」 | ✅ 已落盘 |

**PM 对"超出要求的改动"的主动说明**：PM 明确说明其直接修改了 FR-018① 所在的表格行（追加引导句，原①② 一字未改），理由是"文档修正必须落在被引用的那一行，否则交叉验证机制本身失效"。
→ **QA 认可此判断**。若只在第 9 章声明"以本章为准"而 FR 表格正文仍是旧表述，下一轮 QA 按 FR-018① 字面复核时会重复报出同一"不一致"（正是我 R2.3 的成因）。**PM 的处理方式使文档闭环，是正确的做法。**

**本项（`splitClip` 100ms 校验）正式关闭**：从「待确认的设计决策」转为 **「已确认 · 符合规格」**。

---

## T3.8.2 事实更正：剪映 / Premiere 的对照表述 —— QA 认错 ✅

PM 指出我 R2.3 中的一行有误：

> **我的原表述**：剪映 / Premiere：允许切出任意非零长度的片段
> **PM 的纠正**：它们**确实设限**，下限是「1 个项目帧」而非固定毫秒值

**QA 接受此更正，我的原表述不准确。** 该行已在本报告 R2.3 表格中就地标注更正（见上文 R2.3「与专业剪辑软件对比」行）。

**更重要的是 PM 补充的架构论证，它比我的表述更有力**：

| | 剪映 / Premiere | 本项目 |
|---|---|---|
| 编辑期时间单位 | **帧**（全程帧锁定） | 毫秒 |
| 导出期 | 帧 → 帧 | 毫秒 → 量化到帧 |
| 能否安全允许 <1 帧片段 | 能 | **不能** |

→ 我原表述的错误在于**只看了"能否切出短片段"这一行为结果，没看"编辑期时间单位"这一前提**。而正是这个前提决定了"行为可照搬"还是"行为不可照搬"。**PM 的论证（架构不同，不能照搬竞品行为）成立，且比我原本的论证更根本。**

### 我的补充：PM 的论证在**本项目内也成立**，可独立验证

PM 的"帧锁定缺失"论断与我的实测结论一致 —— 本项目的丢帧发生在**导出采样阶段**，而非编码器内部：

- `webCodecsExporter.ts` L201：`timeMs = (index * 1000) / fps` —— 编辑期（毫秒）在此才被**量化为离散帧时刻**
- `compositor.ts` L46：`isActiveAt` 用半开区间 `timeMs >= startMs && timeMs < startMs + durationMs` 判定

即：**片段是否出现，取决于导出帧时刻是否落入片段区间**，与编码器行为无关。这正是"编辑期毫秒 + 导出期量化"架构的必然结果，与 PM 的论证完全吻合。

### 结论

| 项 | 判定 |
|---|---|
| PM 的决定性理由（放宽会静默丢帧） | ✅ **成立**，我第二轮即实测确认（R2.3 变异测试：移除校验会产出 `durationMs=50` 且被自身 assert 判违规的 clip） |
| PM 对竞品的纠错 | ✅ **正确**，QA 认错 |
| PM 的架构论证（帧锁定缺失） | ✅ **成立**，与我的代码级实测一致 |
| 方案 1（维持 100ms） | ✅ **已裁定并落盘**，实现侧无需改动 |

---

## T3.8.3 PM 提出的「导出帧率 ≥10fps」护栏 —— 已在 T3.1/T3.3 完成，但结论需回填

PM 在 §9.3 动作 5 写「此处仅作确认」，并在消息中请 QA 确认。

**该项我在第三轮（T3.1/T3.3）已完整做完，结论是「UI 层满足，但系统层无保障」**：

| 层 | 现状 | 判定 |
|---|---|---|
| UI `ExportSection.tsx` L115 | `[24,25,30,50,60]` | ✅ 全部 ≥10fps，满足 |
| Schema `project.schema.json` L80/L104 | `minimum: 1` | ❌ **允许 fps=1** |
| 领域层 `exportPlan.ts` L72 | `Math.max(1, ...)`，无 `MIN_EXPORT_FPS` | ❌ **下限是 1** |
| 状态层 `operations.ts` L931 | `setExportSettings` 无钳制 | ❌ 无钳制 |

→ **PM §9.3 动作 5 的「满足前提」结论需要修正**：前提在 **UI 路径**成立，但在**系统路径**不成立 —— 用户改 `.clipcut.json` 写 `"fps": 5` 即可击穿，**且导出零提示、100ms 片段在成片中静默消失**（T3.3 已端到端复现）。

**这一条对 D-001 的意义**：D-001 的安全论证写的是「100ms 在任何 ≥10fps 的帧率下都 ≥1 帧」，这个**条件句本身正确**，但**当前实现无法保证"任何 ≥10fps"成立**。因此 D-001 的安全前提在补上 `MIN_EXPORT_FPS` 之前，**只在正常 UI 路径下成立**。

→ **这不是 D-001 的缺陷**（D-001 的 100ms 闸门选对了），而是**闸门旁缺一道护栏**。已在 T3.4 给出 4 处修法，并已同步工程师。

---

## T3.8.4 PM 新增的 FR-018④（P0）—— QA 核实当前实现缺口

PM 新增 **FR-018④（P0）** 作为方案 1 的必要对价。逐条核实当前实现：

### 需求点 1：提示文案含「两侧实际时长 + 下限值 + 可执行替代动作」

**当前实现**（`operations.ts` L483-487）：
```ts
throw new NotSplittableError(
  `分割后任一侧时长不足 ${MIN_CLIP_DURATION_MS}ms（左 ${leftDuration}ms / 右 ${rightDuration}ms）`,
);
```
| 文案要素 | 现状 |
|---|---|
| 两侧实际时长 | ✅ 已有（左 Xms / 右 Yms） |
| 下限值 | ✅ 已有（`${MIN_CLIP_DURATION_MS}ms`） |
| **可执行替代动作** | ❌ **缺失** —— 无"请将播放头右移"之类的引导 |

⚠️ **且该文案是领域层硬编码中文字符串**，未经 i18n —— 与 FR-018④ 要求的 i18n 键位 `timeline.split.tooShort` 冲突。需一并处理（要么参数化，要么移到 UI 层组装）。

### 需求点 2：播放头进入危险区时分割按钮 disabled + tooltip

**当前实现**（`TimelineToolbar.tsx` L40-46）：
```tsx
<Button
  size="sm" variant="ghost"
  disabled={selectedClipIds.length === 0}      // ← 只看是否选中 clip
  onClick={() => report(splitSelectedClip())}
>
```
| 要求 | 现状 |
|---|---|
| 按钮 disabled | ✅ 机制存在（`disabled` prop 已用） |
| **判断依据含危险区** | ❌ **缺失** —— 当前只看 `selectedClipIds.length === 0`，**不看播放头位置** |
| **tooltip 说明原因** | ❌ **缺失** —— Button 组件未接 tooltip（项目已有 `radix-ui/react-tooltip` 依赖） |

→ 需新增：一个「当前播放头位置是否落在选中 clip 的首/尾 100ms 危险区」的**纯函数选择器**（建议放 `domain/timeline/selectors.ts`，可单测），UI 据此 disabled + tooltip。

### 需求点 3：i18n 键 `timeline.split.tooShort`（zh-CN / en-US）

**当前实现**：
- `zh-CN.ts` L103 有 `'timeline.split': '分割'`，**无 `timeline.split.tooShort`**
- `en-US.ts` 同样无该键
- 现有 `timeline.*` 键位：zh-CN 36 个 / en-US 36 个（**数量一致** ✅，说明 i18n 有一条"两语言包键数必须相等"的守护，`i18n.test.ts` 有覆盖）

→ 需在**两个语言包各加 1 个键**，并注意占位符命名要能承载「左/右时长 + 下限值 + 建议动作」三个变量。

### 需求点 4（PM 提及的「唯一净新增工作量」）：排进 T15

TASKS.md T15 = 时间线面板 UI。**T15 当前状态为 completed**（第一轮 task list 确认）→ 本项属**返工**，建议在 TASKS.md 补一行 T21 或在 T15 下追加子项，避免"已完成任务里藏新需求"导致后续 QA 漏检。

### FR-018④ 缺口小结（交工程师）

| # | 子项 | 缺口 | 位置 |
|---|---|---|---|
| 1 | 文案加"可执行替代动作" | ❌ 缺 | `operations.ts` L485 |
| 1b | 文案走 i18n（不硬编码中文） | ❌ 缺 | `operations.ts` L485 |
| 2 | 危险区判定选择器 | ❌ 缺 | 建议新建于 `domain/timeline/selectors.ts` |
| 3 | 分割按钮 disabled + tooltip | ❌ 缺 | `TimelineToolbar.tsx` L40-46 |
| 4 | i18n 键 `timeline.split.tooShort` | ❌ 缺 | `zh-CN.ts` / `en-US.ts` |
| 5 | TASKS.md 补录 | ❌ 缺 | `docs/TASKS.md` |

---

## T3.8.5 D-002 相关：QA 的一处判断需部分修正，但核心结论不变

PM 裁定 FR-012 为 P1 不在 P0 门禁内，**这一点 QA 接受**（第一轮报告 §6.2 已把 FR-011/FR-012 标为 ❌ 并注明"P1，PRD 允许延后"，本就不在 47 条 P0 门禁计数内 —— 附录 §6.11 的 P0 统计亦未将其计入）。

PM 称「QA 的 grep 只搜了 `Connector` 关键字，因而漏掉了这条实际已覆盖的路径」—— **此处需澄清**：

**QA 在第三轮（T3.5）并未只搜 `Connector`**。实际执行的核查是：
```
grep -rn "listFiles" packages/app/src --include=*.ts --include=*.tsx
  → platform/errors.ts:22（注释）
  → platform/PlatformBridge.ts:38（接口声明）
  → platform/index.ts:31（错误类型导出）
  → 无 components/ / hooks/ / services/ 引用
```
**第四轮再次穷举核查（含动态调用形式 `.listFiles(`）**：
```
grep -rnE "\.(readFile|saveFile|listFiles|storage|getMediaDuration|capability)\(" packages/app/src
  → saveFile:      App.tsx:92              ✅ 有调用方
  → readFile:      MediaPanel.tsx:134、ImportProjectDialog.tsx:39、RelinkDialog.tsx:39  ✅ 有调用方
  → capability:    StatusBar.tsx:27、CapabilitiesTab.tsx:20  ✅ 有调用方
  → storage:       i18n/index.ts:61        ✅ 有调用方
  → listFiles:     （无）                  ❌ 唯一没有任何调用方的 bridge 方法
```
→ **`listFiles()` 是 `PlatformBridge` 六个方法中唯一没有任何调用方的一个。** 这不是"grep 关键字选错"，而是穷举后的客观事实。

### 因此 D-002 的裁定我完全接受，但「用户能力已实现」的措辞仍需修正

| PM 的表述 | 核实结论 |
|---|---|
| 「`listFiles()` 含 showDirectoryPicker、递归深度上限 2、UnsupportedOperationError 优雅降级」 | ✅ **全部属实**（T3.5 已逐条实测） |
| 「`AssetSourceType` 含 `'connector'`」 | ✅ **属实**（`shared-types/src/project.ts:17`） |
| 「i18n 键 `media.tab.connector` / `media.connectorNotImplemented` 存在」 | ✅ **属实**（zh-CN L77/L96、en-US L77/L96） |
| 「**用户能力未缺失**——用户真正感知的是『能不能选文件夹导入素材』，该能力已实现」 | ⚠️ **平台层能力属实，但用户可达性不成立** |

补充两点实测：
1. **`media.tab.connector` 这个 i18n 键在组件中未被引用** —— `grep -rn "media.tab.connector" packages/app/src`（排除 locales）→ **零命中**；`MediaPanel.tsx` 中也无任何 `tab` 结构。→ 连接器 Tab **连 UI 入口都没有**，i18n 键是预置的。
2. **素材面板的「导入」按钮走的是 `readFile`（多选文件），不是 `listFiles`（目录）** —— `MediaPanel.tsx` L134：`.readFile({ accept: FILE_ACCEPT.split(','), multiple: true })`。用户点「＋导入」拿到的是**文件选择器**，**无法选择文件夹**。

→ **修正后的准确表述**：「平台层已具备目录选择与递归列举能力（`WebPlatformBridge.listFiles()`，深度上限 2，降级优雅），但**该方法目前无任何调用方，UI 无目录导入入口**；用户当前的导入路径是 `readFile()`（多选文件），无法选文件夹。」

→ **这不影响 D-002 的裁定**（移除 `LocalFolderConnector` 是正确的 YAGNI 判断，QA 认同）。仅影响「FR-012 用户能力已覆盖」这一表述的准确性。

**归属**：产品（措辞修正）· 工程师（`MaterialSourceConnector` 接口 + TASKS 修正，均为 PM §9.3 已列动作 2/3）。

---

## T3.8.6 第四轮总结

| 项 | 状态 |
|---|---|
| **R2.3 `splitClip` 100ms** | ✅ **已确认 · 符合规格**（PM 裁定方案 1，PRD §9.1 D-001 已落盘），本项关闭 |
| **我的剪映/Premiere 表述错误** | ✅ **认错并已就地更正**（PM 纠错正确，补充了「帧锁定」这一更根本的论证前提） |
| **PM §9.3 动作 5（fps ≥10fps 护栏）** | ⚠️ **第三轮已完成，但结论需回填**：UI 层满足，**系统层不满足**（JSON 绕过路径已端到端复现）→ D-001 的安全前提在补 `MIN_EXPORT_FPS` 前仅在正常 UI 路径成立 |
| **FR-018④（P0，PM 新增）** | 📋 **QA 已核实 5 项实现缺口**，交工程师排期（见 T3.8.4） |
| **D-002 / FR-012** | ✅ 裁定接受；仅「用户能力已覆盖」措辞需修正（平台层有、用户层无入口） |
| 源文件改动 | **无**（本轮纯只读） |

### 缺陷状态总表（截至第四轮）

| 编号 | 严重级别 | 状态 |
|---|---|---|
| BUG-01 | 阻塞 | ✅ FIXED（第二轮验证） |
| BUG-02 | 重要 | ⏸ 仍在（autoSave 零测试） |
| BUG-03 | 重要 | ⏸ 仍在（音频引擎零测试） |
| BUG-04 | 重要 | ⏸ 仍在（导出管线零测试） |
| BUG-05 | 次要 | ⏸ 仍在（validation.ts 覆盖 69.35%） |
| BUG-06 | 次要 | ✅ FIXED（第二轮验证） |
| BUG-07 | 次要 | ✅ 已解决（`test:workspace` 已接线） |
| R2.3 | 次要 | ✅ **已确认符合规格**（PM 裁定方案 1）→ 关闭 |
| T3.3 fps 下限缺失 | **重要** | ⚠️ **新发现 · 待修**（`MIN_EXPORT_FPS` 缺失，JSON 绕过 → 静默丢帧） |
| T3.5② listFiles 无调用方 | 次要 | ⚠️ 待修（能力未接线） |
| T3.5② listFiles 无文件数上限 | 次要 | ⚠️ 待修（接线时一并处理） |
| T3.8.4 FR-018④ 五项缺口 | **P0** | ⚠️ **新需求 · 待实现**（PM §9.1 硬要求） |

### 最终智能路由判定：`NoOne`（维持）

**理由**：R2.3 已由 PM 裁定闭环并落盘规范；我的一处事实表述错误已认错更正。本轮新增的 FR-018④ 是 **PM 新增的 P0 需求**（非缺陷），T3.3 fps 下限是**规格未覆盖的护栏缺失**（FR-038 未要求下限），两者都属**新增工作量**而非"实现与自述不符"。

**待办归属**：
- **工程师**：① T3.3 fps 下限 4 处（`MIN_EXPORT_FPS` + Schema + 钳制 + 契约测试）② FR-018④ 5 项（T3.8.4 表）③ `MaterialSourceConnector` 接口 ④ TASKS.md T14/T15 修正 ⑤ `listFiles` 接线 + 文件数上限 ⑥ BUG-02/03/04 services 层测试
- **产品经理**：① FR-012「用户能力已覆盖」措辞修正 ② FR-038 补 fps 下限（§9.3 动作 5 结论回填）

---

## T3.8.7 附带确认：工程师已实现我建议的 `redirectTempDir` 修复 —— **验证通过** ✅

我在 R2.7 建议 2 中提出的「恢复 `redirectTempDir()` 为可用实现」，工程师**已实现且优于我的提案**。

**当前实现**（`packages/app/vitest.config.ts` L19-34）：
```ts
function redirectTempDir(): void {
  try {
    const dir = resolvePath('./node_modules/.vite/tmp');
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');   // ← 写探针
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    process.env['TEMP'] = dir;
    process.env['TMP'] = dir;
    process.env['TMPDIR'] = dir;
  } catch { /* 保持系统默认行为 */ }
}
```

**我原提案**只是"修好 `mkdirSync` import"，工程师额外加了**写探针**（先确认目标目录真可写再改写 TEMP），避免把 TEMP 指向不可用位置造成挂起 —— **这比我原本的建议更稳健，采纳**。

### 实测验证（不设任何 TEMP 环境变量）

```
$ unset TEMP TMP TMPDIR; pnpm test
Test Files  20 passed (20)
      Tests  134 passed (134)      ← app
 Test Files  1 passed (1)
      Tests  7 passed (7)          ← shared-types
test EXIT=0
Errors 计数 = 0
```
✅ **20 个测试文件全部跑到、141 用例全过、退出码 0、无 Unhandled Errors** —— 与我在 T3.1 手动设置 `TEMP` 才能达到的效果一致，**环境问题已从根上解决**。

---

## T3.8.8 附带发现：Vite 配置临时产物会污染 `pnpm lint`（次要）

**现象**：本轮复跑门禁时 `pnpm lint` 一度返回 `EXIT=1`，报 5 个 `no-undef` 错误。

**根因**：Vite 在加载 TS 格式的配置文件时，会在**配置文件所在目录**生成一个带时间戳的临时编译产物：
```
packages/app/vitest.config.ts.timestamp-1792716776453-96edd159cfd18.mjs
```
该文件是 `vitest.config.ts` 的编译副本，**含 `process` / `URL` 等 Node 全局**，而 ESLint 的 `files: ['**/*.{ts,tsx}']` 配置不匹配 `.mjs`，导致它落入 JS 通用规则集 → `no-undef` 报错。

**复现（已实测）**：
```
$ printf 'const x = 1;\n' > packages/app/vitest.config.ts.timestamp-test.mjs
$ pnpm lint
  packages/app/vitest.config.ts.timestamp-test.mjs
    1:7  error  'x' is assigned a value but never used  @typescript-eslint/no-unused-vars
  ✖ 1 problem (1 error, 0 warnings)
EXIT=1
```

**为何值得关注**：这类产物在**正常 `pnpm test` 后会被自动清理**，但当测试进程被**中断/超时/kill** 时会残留（我第三轮有一次 coverage 运行被 kill，就留下了一个残留文件），此时：
- `pnpm lint` **失败**（CI 门禁红）
- 残留文件会被 `git add .` 意外提交（`.gitignore` **未覆盖**该模式，`eslint.config.js` 的 ignores 也只忽略 `**/*.config.mjs`，不匹配 `vitest.config.ts.timestamp-*.mjs`）

**修复建议**（次要，2 行）：
1. `.gitignore` 增加 `*.timestamp-*.mjs`
2. `eslint.config.js` 的 `ignores` 增加 `'**/*.timestamp-*.mjs'`（或更宽的 `'**/*.timestamp-*'`）

**严重级别：次要** —— 仅在测试进程被异常中断后出现，根因是工具链产物 + 忽略规则不全，非业务代码问题。
**归属：工程师**（可并入下一轮顺手处理）

---

*第四轮复核完*
---

# 第五轮：分层校验一致性横向排查（终轮）

> 复核人：严过关（Yan）· QA Engineer　|　日期：2026-10-23
> 触发：PM 指出 D-003（fps 下限）暴露的是一类模式 —— **「UI 层写死、外部输入可绕过」**，要求横向排查是否不止一处；team-lead 要求评估「D-001 + D-003 不可拆分发布」在门禁流程的可执行性
> 复核方式：**Schema 约束全量抽取 → 与领域层/状态层交叉比对 → 逐项构造性实测**（本轮未修改任何源文件）

## T4.0 结论摘要

| 项 | 结论 |
|---|---|
| 排查方法 | 抽取 Schema **全部 65 条约束**，逐条与领域层/状态层钳制比对，构造性实测 27 个用例 |
| **PM 的模式判断** | ✅ **成立且不止一处** —— 发现 **1 项高危（阻塞级）** + 1 项中危 + 2 项次要 + 若干低危加固项 |
| **最严重发现** | 🔴 **NEW-BUG-01（阻塞）**：`clip.durationMs` 在导入时**从未重算** → 违反 PRD §4.1 硬不变式 → 可致导出时长膨胀 **200 倍**、静默产出 16.7 分钟空白视频 |
| **「不可拆分发布」可执行性** | ✅ **可执行**，但**门禁脚本需增加一条校验**（PM 已提出，QA 采纳并给出具体实现） |
| **是否降级为告警** | ❌ **不降级** —— 但理由与 PM 不同，见 T4.4（降级方案有一个 PM 未注意到的**致命前提问题**） |

---

## T4.1 排查方法（交叉比对，非关键字 grep）

**步骤 1**：脚本化抽取 `schema/project.schema.json` 全部约束（`minimum` / `maximum` / `exclusiveMinimum` / `minLength` / `minItems` / `enum` / `pattern`）→ **共 65 条约束**，覆盖 7 个 `$defs` + 顶层 properties。

**步骤 2**：在领域层定位对应的钳制/校验逻辑：
- `operations.ts` L648-664 `NUMERIC_RANGES`（12 条路径的钳制表，**仅经 `setClipProperty` 生效**）
- `invariants.ts` `assertClipInvariants` / `fixClipDuration`
- `exportPlan.ts` `buildExportPlan`
- `deserialize.ts` `fillClipDefaults` / `fillTrackDefaults` / `fillAssetDefaults`（**只补缺失，不做范围钳制**）

**步骤 3**：对每个疑似不一致项构造**改 JSON → 导入**的用例，实测是否被拒 + 后果。

> **关键结构发现**：`NUMERIC_RANGES` 只挂在 `setClipProperty`（UI 写属性的入口）上。**`deserialize` 走的是 `fillMissing` 路径，完全不经过 `NUMERIC_RANGES`**。这意味着：**领域层的数值范围约束对导入路径整体无效** —— 这是本次所有发现的共同根因。

---

## T4.2 高危发现：NEW-BUG-01【阻塞】`clip.durationMs` 导入时从未重算

### 定位

**文件**：`packages/app/src/domain/project/deserialize.ts`

`deserialize` 的后处理流程（L181-186）：
```ts
// 5) 时间字段取整
roundTimeFields(migrated);

// 6) 派生量重算覆盖
const doc = migrated as unknown as ProjectDoc;
doc.meta.durationMs = computeProjectDuration(doc);
```
**只重算了 `meta.durationMs`（工程级派生量），从未对 clip 调用 `fixClipDuration`（clip 级派生量）。**

验证：`grep -c "fixClipDuration" packages/app/src/domain/project/deserialize.ts` → **0**。

### 根因

PRD §4.1 明文规定：
> **时长不变式** | 恒有 `durationMs == (outMs - inMs) / speed`。任何变速/裁剪操作后必须重算，**不得产生不一致数据**。

而 Schema 对 `clip.durationMs` 只有 `minimum: 0`（`schema/project.schema.json` L217），**与 `inMs`/`outMs`/`speed` 之间没有任何交叉约束**。三者各自合法，组合起来却能违反不变式。

> **这正是 D-003 模式的变体，但后果严重得多**：D-003 是「约束缺失」，NEW-BUG-01 是「**派生量根本没算**」。

### 实测（构造性用例，4 个场景全部复现）

```
>>> D1: 导入后 clip.durationMs = 999999（未被重算）
    真实源区间时长 = 5000ms，导出时长却是 999999ms
    膨胀倍数 = 200x  → 导出将产出大量空白帧
>>> D2: durationMs=0 → 片段在时间线上不可见但仍占 meta?
    durationMs=0，meta.durationMs=0
    片段时长 0 → isActiveAt 恒 false → 预览与导出均不可见，但工程里存在该 clip
>>> D3: inMs=5000 outMs=100 dur=4900（源区间倒置）
    inMs=5000 outMs=100 durationMs=4900
    渲染时 sourceMs = inMs + (timeMs - startMs)*speed，当 timeMs<inMs 时 sourceMs 超出素材范围
>>> D4: 序列化会把违规 durationMs 原样写回（污染扩散）
    序列化输出 clip.durationMs = 999999（原样写回）
    meta.durationMs = 999999
```

**导出层后果实测（E1）**：
```
>>> plan.durationMs = 999999ms (1000 秒)
>>> plan.totalFrames = 30000 帧（30fps 下需渲染 16.7 分钟）
>>> plan.errors = []
>>> 是否有任何告警阻止？ ❌ 无 —— 用户点了导出就会跑 20 分钟
```

→ `buildExportPlan` 的 `errors` 为**空**，导出**照常启动**，用户等待 16.7 分钟得到一段几乎全黑的视频。

### 触发路径（与 D-003 同款，但更简单）

**任何用户 3 步可复现**：
1. 文本编辑器打开 `.clipcut.json`
2. 把某个 clip 的 `"durationMs": 5000` 改成 `"durationMs": 999999`
3. 导入 → **成功，无任何提示** → 点导出 → **16.7 分钟空白视频**

（也可由**第三方分享的工程文件**携带 —— 这正是 D-003 的同一现实场景。）

### 与 BUG-01 的区别（重要）

| | BUG-01（已修复） | NEW-BUG-01（本轮新发现） |
|---|---|---|
| 问题位置 | `fixClipDuration` **内部**钳制 | `deserialize` **完全没调用** `fixClipDuration` |
| 触发方式 | 高倍速变速（UI 可达） | 改 JSON（外部输入） |
| 表现 | fix 产出矛盾数据 | 导入直接接受矛盾数据 |
| 修复 | 已完成（第二轮） | **待修** |

**两者叠加后果更严重**：BUG-01 修复后，`fixClipDuration` 是"忠实按公式"的正确函数；但由于 `deserialize` 不调用它，**这个正确函数在导入路径上从未生效**。等于修好了工具但没插上电。

### 修复建议

**① `deserialize` 对每个 clip 调用 `fixClipDuration`**（最小改动，与 `meta.durationMs` 的处理方式对称）：
```ts
// 6) 派生量重算覆盖
for (const track of doc.tracks) {
  for (const clip of track.clips) {
    const fixed = fixClipDuration(clip);
    clip.durationMs = fixed.durationMs;   // ← 新增
  }
}
doc.meta.durationMs = computeProjectDuration(doc);
```
⚠️ 注意：`fixClipDuration` 对 `assetId === null` 的文字 clip **直接返回原值**（不重算），这与 PRD「文字片段时长独立于素材」一致，**不会破坏文字轨语义**。

**② Schema 增加交叉约束**（可选，防御性加固）：
JSON Schema 难以表达 `durationMs == (outMs-inMs)/speed`（需要 `$data` 扩展），但可以加**必要的弱约束**：
```json
"durationMs": { "type": "number", "minimum": 0 }
```
保持不变，但**依赖 ① 的重算**来保证一致性 —— 这是正确分工：**Schema 守住类型与量纲，领域层守住不变式**。

**③ 补回归测试**（守护 ①）：
```ts
it('导入时重算 clip.durationMs（PRD §4.1 不变式）', () => {
  const json = readFixtureJson('full.clipcut.json');
  // 篡改 durationMs
  const clip = (json.tracks[0].clips[0] as any);
  clip.durationMs = 999999;
  const doc = deserialize(json);
  expect(doc.tracks[0].clips[0].durationMs).toBe(
    Math.round((clip.outMs - clip.inMs) / clip.speed)
  );
});
```

**④ 顺带覆盖 `inMs > outMs`（源区间倒置）**：`fixClipDuration` 会算出**负数** durationMs（实测：`4900 !== -4900`）。建议 `deserialize` 对 `outMs <= inMs` 的 clip 显式拒绝（抛 `ValidationError`），而非静默产出负时长。Schema 无法表达该约束，只能在领域层做。

### 严重级别：**阻塞**

| 维度 | 评估 |
|---|---|
| 触发难度 | **低**（改一个数字） |
| 后果 | **用户可见的数据损坏**（16.7 分钟空白视频）+ **长时间无效等待** + 违反 PRD 明文硬不变式 |
| 是否需特殊环境 | 否 |
| 是否阻断正常用户 | 否（正常 UI 不会产生） |
| **定级** | **阻塞** —— 与 D-003 同为"安全依赖"性质，且后果更严重（不只是丢帧，是整段视频报废 + 用户等待 20 分钟） |

> **归入 D-003 同组**：NEW-BUG-01 与 D-003 都是「外部输入可绕过 UI 约束」，建议**合并为一个修复批次**（见 T4.4）。

---

## T4.3 其余排查结果（按严重级别归类）

### 【重要】NEW-BUG-02：`transform` / `text` 数值范围在导入时完全不生效

`NUMERIC_RANGES`（`operations.ts` L648-664）定义了 12 条路径的范围，但**只经 `setClipProperty` 生效**，`deserialize` 不走这条路径。

**实测（4 项全部导入通过，领域层范围形同虚设）**：

| 字段 | Schema 约束 | 领域层 `NUMERIC_RANGES` | 实测结果 |
|---|---|---|---|
| `transform.scale` | `exclusiveMinimum: 0`（无上限） | `[0.01, 20]` | ✅ 导入通过：`scale=0.001` / `scale=1000` |
| `transform.rotation` | **无约束** | `[-3600, 3600]` | ✅ 导入通过：`rotation=1000000000` |
| `transform.cornerRadius` | `minimum: 0`（无上限） | `[0, 1000]` | ✅ 导入通过：`cornerRadius=99999` |
| `text.lineHeight` | `exclusiveMinimum: 0`（无上限） | `[0.1, 10]` | ✅ 导入通过：`lineHeight=0.001` |

**后果分析**：
- `scale=0.001` → 片段在画布上缩到 1/1000，**视觉上消失**（用户会以为片段丢了）
- `rotation=1e9` → `ctx.rotate(1e9 * π/180)` → 三角函数周期性旋转，虽不崩但语义完全失真
- `cornerRadius=99999` → 圆角半径远超画布，`arcTo` 半径被钳制，画布可能**全黑**
- `lineHeight=0.001` → 文字行间距塌缩，多行文字重叠成一团

**定级：重要（P1）** —— 全部是**视觉层面**的破坏（不是数据丢失、不是崩溃），且用户在 UI 里改这些值时会被正常钳制，只有改 JSON 才触发。

**修复建议**：
- **首选**：`deserialize` 在补默认值时**同时做范围钳制**（复用 `NUMERIC_RANGES`，把它抽成可复用的 `clampToRange(path, value)`，供 `setClipProperty` 与 `deserialize` 共用）—— 与第二轮 BUG-01 的"单一公式源"思路一致
- **配套**：Schema 补齐上限（`scale` 加 `maximum: 20`、`rotation` 加 `minimum/maximum`、`cornerRadius` 加 `maximum: 1000`、`lineHeight` 加 `maximum: 10`），让**导入阶段**就能给出明确错误而不是静默钳制

### 【次要】NEW-BUG-03：`track.height` 无上限 → 时间线布局被撑爆

- Schema：`track.height` 仅 `exclusiveMinimum: 0`，**无上限**
- 实测：导入 `height = 1e9` → **通过** → 轨道头高度 10 亿 px → 时间线面板布局崩溃
- 领域层 `fillTrackDefaults` 只在 `height <= 0` 时重置为 56，**不处理过大值**
- **定级：次要** —— 需用户主动构造，且后果是 UI 布局破坏（可刷新恢复），不涉及数据丢失
- **修复建议**：Schema 加 `maximum: 200`（UI 侧轨高通常 ≤ 120px），或领域层钳制

### 【次要】NEW-BUG-04：`canvas.width/height` 无上限（但导出层已兜住）

- Schema：`minimum: 1`，**无上限**；实测 `100000 × 100000` 导入通过
- **但导出层有兜底**：`buildExportPlan` 实测产出 `errors: ["分辨率 100000×100000 超出浏览器硬编码上限（约 4K）。"]` + `suggestions: ["降至 1080p","降至 720p"]` ✅
- → **仅预览层有风险**（预览 canvas 按 `canvas.width/height` 分配，超大值可能耗尽内存），导出路径安全
- **定级：次要** —— 导出已被拦截，风险面收窄到预览
- **修复建议**：Schema 加 `maximum: 7680`（8K）或领域层钳制

### 【低危 · 归类汇总，不逐条展开】

以下均为**防御性加固**性质，无严重后果，归为一类统一处理即可：

| 项 | 说明 |
|---|---|
| `clip.zIndex` 无 Schema 约束 | 领域层 `[0,1000]`；越界仅影响 overlay 排序，无崩溃 |
| `meta.lastExport.fps` 无约束 | 纯历史元数据，不参与渲染/导出计算 |
| `waveform` 无 `maxItems` | PRD 说"默认 400 个采样点"；实测 100000 点可导入（内存占用但可控）。Schema 的**元素范围 `[0,1]` 校验有效**（实测 2.0 / -1 均被拒） |
| `tracks` 数组无 `maxItems` | PRD FR-013 只要求支持 ≥12 轨；实测 10000 轨可导入。属容量问题非正确性问题 |
| `text.content` 无 `maxLength` | 超长文本渲染性能问题，非正确性 |
| `projectMeta.durationMs` 无上限 | 派生量，加载时会被 `computeProjectDuration` 覆盖 ✅ |

**Schema 校验确实有效的项**（实测确认，非缺口）：`asset.sizeBytes >= 0`、`audio.gain ∈ [0,2]`、`transform.opacity ∈ [0,1]`、`transform.x/y ∈ [0,1]`、`clip.speed ∈ [0.1,10]`、`waveform` 元素 `∈ [0,1]`、`track.type` / `asset.type` / `fit` / `align` 等所有 enum、`aspectPreset` enum。

---

## T4.4 「D-001 + D-003 不可拆分发布」在门禁流程的可执行性评估

### PM 的判断 —— QA 认可 ✅

> 单发 D-001 会让人误以为"最小片段问题已解决"，但绕过路径依然存在 —— **这比不做更危险，因为它关闭了警报**。

**这个论证成立**。QA 补充一条同构的论证支持它：

D-001 与 D-003 的关系是**单向依赖**：
```
若只有 D-001（片段 ≥100ms）而无 D-003（fps ≥10）：
  用户改 JSON → fps=5 → 100ms 片段静默消失
  → "最小片段下限"这一承诺在特定条件下失效
  → 用户可能据此认为"100ms 就安全了"，从而基于错误前提做决策

若只有 D-003（fps ≥10）而无 D-001：
  fps 恒 ≥10 → 任意长度的片段都不会整段丢失
  → D-003 单独就足以保证"不丢帧"
```
→ **D-003 单独发布是安全的；D-001 单独发布不安全**。因此"不可拆分"的方向正确，但**严格说应该是「D-001 依赖 D-003」而非「两者对称不可分」**。这个方向性对排期有实际影响（见下）。

### 结合本轮新发现的修正

**NEW-BUG-01（durationMs 不重算）应与 D-003 合并为同一批次**，理由：
- 三者根因同构：**外部输入可绕过领域层约束**
- 三者后果同构：**静默产生错误工程数据**（D-003 丢帧 / NEW-BUG-01 视频膨胀）
- 修复位置高度重叠：都在 `deserialize` + Schema + 领域层钳制这一组文件

### 门禁流程上的可执行性 —— 需增加一条校验 ✅

PM 提出：「比对 PRD 的 P0 列表与 TASKS 的任务映射，检查是否有 P0 挂在 completed 任务下」—— **QA 采纳，并给出更精确的形式**：

**建议的门禁校验（新增 `pnpm check:prd-sync`）**：
```
1. 解析 PRD 中所有标记 P0 的 FR 编号
2. 解析 TASKS.md 中每个任务的「覆盖 FR」声明
3. 断言：每个 P0 FR 都能映射到一个**非 completed** 状态的任务
   （或映射到一个显式标记为「新增/返工」的任务条目）
4. 断言：PRD 第 9 章「补充决策记录」中新增的 FR 条目
   （如 FR-038② / FR-018③/④）同样在 TASKS 中有对应任务条目
```

**为什么这条校验不可省略**：本轮已实测两次「状态错位」问题：
- **T15 已是 completed**，但 PM 新增的 FR-018③ 属该任务范围 → 若不显式立项，会在覆盖率核对中被**误判为已交付**
- **T12 已是 completed**，但 D-003（fps 下限）建议并入 T12 → 同样风险

**成本**：约 30 行脚本（读两个 markdown + 正则提取 + 集合比对），一次性投入，永久守护。**建议列为 P1**（与 D-003 同批）。

### 「是否降级为告警而非拒绝」—— QA 结论：**不降级**，但 PM 的理由需要补一条

PM 倾向不降级，理由是"文档留白会被忽略"。**QA 同意结论，但发现 PM 的理由之外还有一条更硬的理由**：

> **降级方案有一个致命前提问题**：D-001 的"拒绝"与 D-003 的"帧率下限"是**同一个不变式的两个约束**。
> - 若 D-001 降级为告警 → 允许创建 <100ms 片段
> - 但只要 fps 能被设为 <10（当前 D-003 未实现），**这个 <100ms 片段就会静默消失**
> - 此时系统会**同时**做两件事：警告"此片段过短" + 静默丢掉它
> - **告警无法阻止已经在渲染管线中发生的丢帧** —— 告警只在 UI 层，丢帧在导出层

换言之：**在 D-003 实现之前降级 D-001，等于把"明确拒绝"换成"明确警告 + 静默丢失"** —— 后者的用户体验**更差**（用户至少还能通过报错知道发生了什么）。

**结论**：
| 方案 | 评价 |
|---|---|
| 方案 A：D-001 + D-003 一起发（D-003 未实现则 D-001 也暂缓） | ✅ **推荐**。工程量上 D-003 只是 4 处小改（Schema 2 行 + `exportPlan.ts` 5 行 + `setExportSettings` 3 行 + 测试），排期代价很小 |
| 方案 B：先发 D-001，D-003 延后 | ❌ 不推荐。见上面的致命前提 |
| 方案 C：D-001 降级为告警 | ❌ **不推荐**。会把"明确拒绝"变成"警告 + 静默丢失"，且告警层拦不住导出层的丢帧 |
| 方案 D：先发 D-003，D-001 延后 | ✅ **可接受**。D-003 单独发布是安全的（fps≥10 恒成立时，任意长度片段都不会整段丢失） |

> **如果排期确实紧张，方案 D 是唯一安全的降级方向** —— 即**优先发 D-003（帧率下限）**，而非优先发 D-001。这个方向性建议是本轮的新增结论。

---

## T4.5 本轮新增缺陷汇总

| 编号 | 严重级别 | 字段 | Schema 约束 | 领域层实际约束 | 可否改 JSON 触发 | 后果 | 归属 |
|---|---|---|---|---|---|---|---|
| **NEW-BUG-01** | **阻塞** | `clip.durationMs` | `minimum: 0`（无交叉约束） | **导入时不重算**（`deserialize` 未调 `fixClipDuration`） | ✅ 3 步 | **违反 PRD §4.1 硬不变式**；导出时长膨胀 200×、16.7 分钟空白视频、`errors` 为空照常导出 | 工程师 + 产品（PRD 明确要求，可直接修） |
| **NEW-BUG-02** | 重要 | `transform.scale/rotation/cornerRadius`、`text.lineHeight` | 无上限 / 无约束 | `NUMERIC_RANGES`（**仅 UI 路径生效**） | ✅ | 片段视觉消失 / 旋转失真 / 圆角全黑 / 行距塌缩 | 工程师 |
| **NEW-BUG-03** | 次要 | `track.height` | `exclusiveMinimum: 0`（无上限） | 仅 `<=0` 时重置 | ✅ | 时间线布局被撑爆 | 工程师 |
| **NEW-BUG-04** | 次要 | `canvas.width/height` | `minimum: 1`（无上限） | 无 | ✅ | 预览层内存风险（**导出层已兜住**） | 工程师 |
| — | 低危（归类） | `zIndex` / `lastExport.fps` / `waveform.maxItems` / `tracks.maxItems` / `content.maxLength` | — | — | ✅ | 容量/性能类，无正确性影响 | 工程师（统一加固） |

**与 D-003 合并后的修复批次**（建议单一 PR 交付）：
1. `MIN_EXPORT_FPS = 10`（`exportPlan.ts`）+ Schema fps `minimum: 10` ×2 + `setExportSettings` 钳制 + 契约测试
2. `deserialize` 对 clip 调用 `fixClipDuration`（NEW-BUG-01）+ `outMs <= inMs` 显式拒绝
3. `NUMERIC_RANGES` 抽成可复用钳制函数，`deserialize` 复用（NEW-BUG-02）
4. Schema 补 `track.height` / `canvas.width/height` 上限（NEW-BUG-03/04）
5. 补契约测试 `MIN_CLIP_DURATION_MS >= 1000 / MIN_EXPORT_FPS`（含 PM 建议的取等说明注释）

---

## T4.6 终轮总结与最终路由判定

### 缺陷总表（截至第五轮 · 终版）

| 编号 | 级别 | 状态 |
|---|---|---|
| BUG-01 | 阻塞 | ✅ FIXED（第二轮验证） |
| BUG-02 / 03 / 04 | 重要 | ⏸ 仍在（autoSave / 音频引擎 / 导出管线零测试） |
| BUG-05 | 次要 | ⏸ 仍在（`validation.ts` 覆盖 69.35%） |
| BUG-06 / 07 | 次要 | ✅ FIXED / 已解决 |
| R2.3 `splitClip` 100ms | 次要 | ✅ **已确认符合规格**（PM 裁定方案 1） |
| T3.3 fps 下限 | 重要 | ⚠️ **D-003 已落盘 PRD，实现中**（工程师在做） |
| **T4.2 NEW-BUG-01 durationMs 不重算** | **阻塞** | ⚠️ **本轮新发现，待修** |
| **T4.3 NEW-BUG-02 transform/text 范围** | 重要 | ⚠️ **本轮新发现，待修** |
| T4.3 NEW-BUG-03 track.height | 次要 | ⚠️ 本轮新发现，待修 |
| T4.3 NEW-BUG-04 canvas 尺寸 | 次要 | ⚠️ 本轮新发现，待修（导出层已兜住） |
| T3.5② `listFiles` 无调用方 / 无文件数上限 | 次要 | ⚠️ 待修（接线时） |
| T3.8.4 FR-018③/④ 缺口（7 项） | P0 | ⚠️ PM 已落盘 §9.8，待实现（i18n 键**已存在未接线**） |
| T3.8.8 vite 临时产物污染 lint | 次要 | ⚠️ 待修（2 行） |

### 最终智能路由判定：`Engineer`

**本轮判定变更**（前四轮为 `NoOne`）—— 原因是**新发现了一个阻塞级缺陷**：

| 项 | 判定 |
|---|---|
| 验证命令 | 5/5 通过（lint 0 / typecheck 0 / test 0（141）/ build 0 / schema:check 0） |
| PM 的「模式判断」 | ✅ **成立且不止一处** —— 本轮实证 4 项同构缺口 |
| **NEW-BUG-01** | 🔴 **阻塞级 · 新发现** —— `clip.durationMs` 导入时不重算，违反 PRD §4.1 硬不变式，可致导出 200× 膨胀且零告警 |
| NEW-BUG-02 | 🟡 重要 · 新发现 |
| NEW-BUG-03 / 04 | 🔵 次要 · 新发现 |
| 「不可拆分发布」可执行性 | ✅ 可执行，**门禁需加一条 P0↔TASKS 映射校验** |
| 「是否降级为告警」 | ❌ **不降级**；若必须降级，唯一安全方向是**优先发 D-003**（而非 D-001） |
| 源文件改动 | **无**（本轮纯只读） |

**判定理由**：所有既有验证命令与前四轮结论均保持有效（`NoOne`），但本轮横向排查**新发现一个阻塞级缺陷**（NEW-BUG-01），且它与 PM 刚升级为 P0 的 D-003 属**同批次、同根因、同修复位置**。因此**需再次路由给工程师**，且建议**合并为一个修复批次**一次交付。

---

## T4.7 QA 侧操作说明

本轮为**纯只读验证**，未修改任何源文件。校验方式：
```
grep -c "fixClipDuration" packages/app/src/domain/project/deserialize.ts          → 0（确认未重算）
grep -c "MIN_EXPORT_FPS" packages/app/src/domain/export/exportPlan.ts              → 0（D-003 未实现）
grep -c '"fps": { "type": "number", "minimum": 1, "maximum": 240 }' schema/...      → 2
grep -rc "tooShort" packages/app/src/components/                                    → 0（i18n 键未接线）
find packages -name "*probe*" -not -path "*/node_modules/*"                        → 0
```
创建过 9 个临时探针测试文件（`probe_audit` / `probe_dur` / `probe_e2e2` / `probe_low` / `probe_wf` / `probe_split` / `probe_split2` / `probe_edge` / `probe_neg` / `probe_fps` / `probe_drop` / `probe_e2e` / `probe_listfiles` / `probe_lf2` / `probe_lf3` / `probe_r2` / `probe_r2b`），**已全部删除**。
门禁复跑：**lint 0 / test 0（141 用例）/ typecheck 0**。

---

*第五轮横向排查完 · QA 阶段收尾*
---

# 第六轮：FR-063 措辞澄清与落地可行性复核（QA 收尾）

> 复核人：严过关（Yan）· QA Engineer　|　日期：2026-10-23
> 触发：PM 落盘 §9.10 D-004（FR-063/064/065），并就「静默重算」与「导入告警」是否冲突向 QA 求证
> 复核方式：**PRD 落盘核实 + 代码可行性实测**（本轮未修改任何源文件）

## T5.0 结论摘要

| 项 | 结论 |
|---|---|
| PRD 落盘核实 | ✅ FR-063/064/065 已落 §3.10.1 + §9.10，统计更新为 **P0=48 / P1=13 / 合计 66**，PRD 共 1022 行 |
| PM 的三条补理由 | ✅ **全部成立**，尤其第 1 条（§4.1 是「不变式」而非「导入校验要求」）—— QA 接受这个更精确的表述 |
| **「静默重算」vs「导入告警」是否冲突** | ✅ **意图无歧义，但字面确实矛盾** → 给出无歧义改写方案（见 T5.2） |
| **更重要的发现** | ⚠️ **FR-063⑥ 在当前 API 下无法实现** —— `deserialize` 无告警通道，且**三个调用方的告警需求完全不同**。若不指定，工程师大概率会实现成"deserialize 内部直接 toast"，导致**用户删工程/打开工程时莫名弹提示**（实测 T5.3） |
| FR-063① 的回归风险 | ✅ **无风险** —— 3 个 fixture 的 clip 全部与公式一致（实测），逐字节往返测试不会被破坏 |
| 路由判定 | `NoOne`（维持）—— 本轮为规格澄清与可行性复核，无新缺陷 |

---

## T5.1 PM 的三条补理由 —— QA 接受

PM 说 QA 的「不需要新 PRD 条目，§4.1 已明文要求」**方向对但需补三条理由**。逐条评估：

### ① §4.1 是「不变式」而非「导入校验要求」—— ✅ 成立，QA 接受这个更精确的表述

PRD §4.1 原文：
> **时长不变式** | 恒有 `durationMs == (outMs - inMs) / speed`。任何**变速/裁剪操作后**必须重算，不得产生不一致数据。

QA 复读后确认：**「任何变速/裁剪操作后」这个限定语确实把适用范围框定在编辑操作上**，从未说过"导入外部数据时也必须重算"。QA 上一轮的表述「§4.1 已明文要求」在**结论方向**上正确（结果确实应该一致），但在**适用范围**上过宽了 —— 这是规格空白，不是实现违背。

→ **接受 PM 的定性**。这直接印证了 PM 关于「描述偏差是文档-实现一致性的主要风险源」的判断 —— QA 自己也犯了一次。

### ② 修复会改变数据契约 —— ✅ 成立

`durationMs` 从「权威数据」降级为「派生数据」，是**数据模型的契约变更**。不写明，工程师实现时会犹豫（可能担心"改了会不会破坏已有工程文件"）。**必须写明。**

### ③ 同批次还有 3 项同构缺口 —— ✅ 成立

不记录会重复排查。**接受。**

**结论：FR-063/064/065 三条新 FR 是必要的，QA 撤回上一轮「不需要新 PRD 条目」的判断。**

---

## T5.2 核心问题：③「静默重算」与 ⑥「导入告警」是否冲突

### PM 的判断

> 我的意图是：**重算动作静默（不阻断导入），但告知用户（告警）** —— 即「静默重算 + 非阻断告警」。但这两条字面上看是矛盾的。

### QA 判定：**意图完全正确且无歧义，但字面确实矛盾，建议改写**

先看落盘文本的实际状态 —— **PRAGMATIC 发现：§9.10 的正文表与 §3.10.1 的 FR-063 行，两处措辞已经不一致**：

| 位置 | ③ 的措辞 | ⑥ 的措辞 |
|---|---|---|
| `PRD.md` L209（§3.10.1 FR-063 行） | 「③ `outMs <= inMs`（源区间倒置）**显式拒绝并报错**，不静默接受」 | 「④ 发生重算时**显式告警**「工程文件存在不一致数据，已自动修正」，**不得静默**」 |
| `PRD.md` §9.10 决策一表 | 「③ 读取时若发现不一致，**静默重算而非报错**」 | 「⑥ **导入告警非阻断**：重算发生时提示…，**不得静默**」 |

**注意 L209 的 ③ 已经不是"静默重算"了** —— 它讲的是 `outMs <= inMs` 的显式拒绝。**真正的"静默重算"在 §3.10.1 表里被删除了**（该项被合并进了 FR-063 的 ① 和 ④）。

→ **所以 PRD 正文（§3.10.1）已经无歧义，只有 §9.10 的论证表还留着旧的 ③ 措辞。** 两处编号体系不同（FR 表 ①②③④⑤ vs §9.10 表 ①~⑥）也加剧了混淆。

### 矛盾的根源：同一个词「静默」被用于两个不同语义

| 出现处 | 「静默」的实际含义 |
|---|---|
| ③ 「**静默**重算而非报错」 | = **不阻断导入**（不 throw、不拒绝） |
| ⑥ 「**不得静默**」 | = **必须告知用户**（不能悄悄改） |

两处「静默」指的是**两件不同的事**，但用了同一个词，所以读起来像自相矛盾。

### 建议的无歧义改写（推荐 PM 采用）

**§9.10 决策一表 ③ 改为**：
> ③ 读取时若发现不一致，**重算并继续导入**（不抛错、不阻断）—— 与 ⑥ 配对：不阻断**导入**，但**必须告知用户**

**§9.10 决策一表 ⑥ 改为**：
> ⑥ **导入告警非阻断**：重算发生时提示「工程文件存在不一致数据，已自动修正」—— 告警**不阻断**导入，但**不得省略**

**同时建议**：§9.10 的 ①~⑥ 编号与 §3.10.1 FR-063 的 ①~⑤ 编号**建立显式对应**，或在 ① 前加一句「（本表 ①~⑥ 对应 FR-063 验收标准；编号不同仅为论证分组，不表示条目数不同）」。

**改写后的语义（无歧义版）**：
```
重算  →  不阻断导入（成功）   ← ③ 管这个
告警  →  必须告知用户         ← ⑥ 管这个
拒绝  →  outMs<=inMs 时报错   ← ⑤ 管这个
```
三者**作用于不同环节，互不冲突**，正是 PM 所说的「三者缺一，用户都无法判断自己的工程是否被改动过」。

---

## T5.3 ⚠️ 更重要的发现：FR-063⑥ 在当前 API 下**无法实现**

PM 的问题聚焦在措辞，但 QA 在核实落地可行性时发现一个**会让实现走偏的技术障碍**。

### 障碍 1：`deserialize` 没有任何告警通道

实测（构造 `durationMs=999999` 的工程后调用）：
```
>>> deserialize 返回类型: ProjectDoc（无 warnings 字段）
>>> 返回对象的键: schemaVersion, projectId, name, createdAt, updatedAt, generator, settings, assets, tracks, subtitles, meta
>>> 有无任何通道能告诉调用方"发生了重算"? ❌ 无 —— 需改签名
```
→ `deserialize(json): ProjectDoc` 的签名**无法表达"发生了重算"**。要满足 ⑥，**必须改返回类型或加旁路参数**。

### 障碍 2：三个调用方对"要不要告警"的需求**完全不同**

| 调用方 | 场景 | 应否告警 |
|---|---|---|
| `ImportProjectDialog.tsx:59` | 用户主动导入外部工程文件 | ✅ **应该告警**（这正是 ⑥ 的目的） |
| `projectRepo.ts:57` `loadProject` | 从 IndexedDB 读取**本应用自己存的数据** | ❌ **不应告警** |
| `projectRepo.ts:75` `deleteProject` | 仅为提取 blobKey 而解析 | ❌ **绝对不能告警** |

### 障碍 3：若图省事在 `deserialize` 内部直接 `toast()` —— 会产生用户可见的骚扰

实测推演：
```
>>> deleteProject 每次删除工程都会 deserialize 一次
>>> 若 deserialize 内部直接 toast → 用户删工程时莫名弹"工程文件存在不一致数据，已自动修正"
>>> 且 loadProject 每次打开工程都会 deserialize → 打开就弹一次
>>> ❌ 这两个路径都不该告警 → 告警必须是"返回值的一部分"而非"副作用"
```

**这是本轮最有工程价值的发现** —— 如果 PRD 不指定告警通道，工程师最自然的实现是"在 `deserialize` 里加个 toast"，而这会在**删除工程**和**打开工程**这两个与"不一致"毫无关系的场景里弹出提示。用户在 V1.0 阶段根本不会遇到不一致数据（正常 UI 产不出），所以这个提示**只会在异常场景出现**，而**恰好在异常场景出现恰恰是它的价值所在** —— 前提是它只在真正需要的场景出现。

### 建议的落地形式（请 PM 补入 FR-063⑥）

**方案 A（推荐）：返回结构化结果，告警由调用方决定**
```ts
export interface DeserializeResult {
  doc: ProjectDoc;
  /** 本次加载中被自动修正的不一致项（可为空） */
  warnings: DeserializeWarning[];
}
export interface DeserializeWarning {
  code: 'duration-recomputed' | 'value-clamped';
  clipId?: string;
  field?: string;
  expected: number;
  actual: number;
}
```
- `deserialize` 保持**纯函数**（不碰 UI、不 toast）—— 符合项目既有分层（`domain` 层零 UI 依赖）
- `ImportProjectDialog` 消费 `warnings` → `toast(t('project.import.autoFixed'), 'warning')`
- `loadProject` / `deleteProject` 忽略 `warnings` → 天然无骚扰
- **向后兼容成本低**：`deserialize` 保留原签名返回 `ProjectDoc`，另加 `deserializeWithWarnings()`；或直接改签名（仅 3 个调用点，实测已确认）

**方案 B（次选）：保留 `deserialize` 签名，增加可选回调参数**
```ts
deserialize(json, { onWarning?: (w: DeserializeWarning) => void }): ProjectDoc
```
- 改动更小，但**回调是副作用**，测试时不如返回值直观

**我推荐方案 A** —— 返回值方案让"是否告警"成为**调用方的显式决策**，而回调方案容易滑向"随手传个 toast 进去"，正是障碍 3 的成因。

**建议 PRD 补一句**：
> ⑥ 告警通过 `deserialize` 的**返回值**传递（不含 UI 副作用）；**由调用方决定是否展示**。仅「用户主动导入外部工程文件」路径需要展示；应用自身存储的工程读取路径不展示。

---

## T5.4 FR-063① 的回归风险核查 —— ✅ 无风险

工程师实现 ①（导入时调 `fixClipDuration`）后，**最可能破坏的既有测试是「逐字节往返一致」**（`serialize.test.ts` L13-19）。实测核查全部 fixture：

```
full.clipcut.json:      媒体 clip 3 个, 不一致 0 个
legacy-0.9.clipcut.json: 媒体 clip 1 个, 不一致 0 个
minimal.clipcut.json:    媒体 clip 1 个, 不一致 0 个
```
→ **3 个 fixture 的 clip 全部与公式一致**，导入时重算的结果 == 原值 → **逐字节往返测试不受影响** ✅

**但有一个新测试必须补**（当前零覆盖，实测确认）：
```ts
// 现有 schema.test.ts 只测「必填字段缺失」和「schemaVersion 格式非法」
// migrate.test.ts 只测「低版本补齐」「高版本拒绝」「版本比较」「不改写」
// → 没有任何测试覆盖「导入时 durationMs 与公式不一致」这个场景
```
建议新增（守护 FR-063①）：
```ts
it('导入时重算 clip.durationMs（派生字段以权威字段为准）', () => {
  const json = readFixtureJson('minimal.clipcut.json') as any;
  json.tracks[0].clips[0].durationMs = 999999;   // 篡改派生字段
  const doc = deserialize(json);
  expect(doc.tracks[0].clips[0].durationMs).toBe(
    Math.round((clip.outMs - clip.inMs) / clip.speed)
  );
});
it('文字 clip 的 durationMs 不被重算', () => { /* assetId === null */ });
it('outMs <= inMs 显式拒绝', () => { /* expect(() => deserialize(json)).toThrow() */ });
```

**另注**：`legacy-0.9.clipcut.json` 也一致（1 个媒体 clip）→ **FR-001③「低版本文件加载不抛异常」不会因 ① 而破** ✅

---

## T5.5 PM 提议的门禁判据 —— QA 复核与补充

PM 在 §9.14 落盘了 `check:prd-sync` 门禁需求，并**补了一条我原方案没有的判据 4**（第 9 章新增 FR 条目也要有任务映射）。**这条补得对** —— 第 9 章是追加章节，其中新增条目**不在 TASKS.md 原有映射表内**，属于天然高危区。已实测三次状态错位（T15/T12），判据 4 能覆盖。

### QA 补充一条判据 5：**FR 编号与 P0 统计的一致性**

PM 已在 §3.11 更新统计（P0=48 / P1=13 / 合计 66）。建议门禁加一条：
> **判据 5**：断言 PRD §3.11 统计表中的 P0/P1 数量，与 PRD 正文中实际标记为 P0/P1 的 FR 条目数**一致**。

**理由**：本轮 PM 手动更新了统计表（47→48、11→13、62→66）。**手工维护的统计表天然会与正文漂移** —— 将来再加 FR 时，若忘了更新 §3.11，就又是一次"描述偏差"。这条校验成本极低（各 FR 行首列就是优先级标记，正则可数）。

**建议的门禁判据全集**（5 条）：
```
1. 每个 P0 FR 都能映射到【非 completed】状态的任务（或显式标记的新增/返工任务）
2. （PM 补充）PRD 第 9 章新增的 FR 条目同样有对应任务条目
3. FR 编号连续无跳号（FR-001 ~ FR-065）
4. 判据 5（QA 补充）：§3.11 统计表数量 == 正文中实际 P0/P1 条目数
5. 门禁脚本自身纳入 typecheck / lint 范围
```

---

## T5.6 关于「FR-064 优先于 FR-063」的门禁体现 —— PM 要求的落地

PM 说：「§9.10 的根因修复（FR-064）如果只做 FR-063 不做 FR-064，下次新增字段仍会重蹈覆辙。这个优先级排序请在门禁里体现。」

**QA 认同这个优先级，并给出可门禁化的具体形式**：

### 建议在 `check:prd-sync` 中增加判据 6：领域层约束的"单点挂载"检测

> **判据 6**：断言 `domain/` 下**不存在**「校验/钳制表仅被单一入口使用」的结构。
>
> 具体实现（静态检查，约 20 行）：
> 1. 定位 `NUMERIC_RANGES`（或任何 `*_RANGES` / `*_LIMITS` 常量表）
> 2. 统计其引用点
> 3. 断言：引用点 **≥ 2**，且**必须包含 `domain/project/deserialize.ts`**（导入路径）

**为什么这条能防复发**：本轮全部 4 项缺口（fps / durationMs / transform 范围 / canvas 尺寸）的根因都是同一个 —— **约束表只挂在一个入口**。如果将来有人又写了一张新表只挂在 UI 入口上，判据 6 就会失败。

**为什么这条比"检查 FR 是否实现"更根本**：它检查的是**结构**而非**条目** —— 条目会变（新增字段），结构不会。

### 同时建议：把 FR-064 的产出形态写进验收标准

FR-064 ② 写的是「领域层不存在"两条路径两套约束"的结构性隐患」—— 这句**正确但不可测**。建议细化为可测断言：
> ② **可测形态**：`NUMERIC_RANGES` 被导出为领域层公开函数 `clampClipProperty(path, value)`，且 `setClipProperty` 与 `deserialize` **均调用同一函数**（可由变异测试验证：移除其中一处的调用，测试必须失败）

这样 QA 下一轮可以用**变异测试**验证 FR-064 是否真做成了 —— 而不只是看代码里"有个导出函数"。

---

## T5.7 第六轮总结

| 项 | 结论 |
|---|---|
| PRD 落盘核实 | ✅ FR-063/064/065 已落 §3.10.1 + §9.10；统计 P0=48 / P1=13 / 合计 66；PRD 1022 行 |
| PM 三条补理由 | ✅ **全部成立**；QA 撤回上一轮「不需要新 FR」的判断 |
| **③「静默重算」vs ⑥「不得静默」** | ✅ **意图无歧义，字面矛盾**。根因是「静默」一词被用于两个语义（不阻断导入 / 不告知用户）。给出改写方案 |
| 附带发现 | ⚠️ **§3.10.1 的 FR-063 表里"静默重算"其实已被删除**（该项合并进 ①④），只剩 §9.10 论证表还留旧措辞 → **两处编号体系不同加剧混淆** |
| **🔴 FR-063⑥ 当前无法实现** | ⚠️ `deserialize` 无告警通道；**三个调用方需求完全不同**；若在 deserialize 内直接 toast → **用户删工程/打开工程时莫名弹提示**。建议补入「告警经返回值传递、由调用方决定是否展示、仅导入路径展示」 |
| FR-063① 回归风险 | ✅ **无** —— 3 个 fixture 全部一致，逐字节往返测试不受影响；但**必须补 3 个新测试**（当前零覆盖） |
| 门禁判据 | ✅ 采纳 PM 的判据 4；**QA 补充判据 5（§3.11 统计表 vs 正文）** 与 **判据 6（约束表单点挂载检测）** |
| FR-064 优先级门禁化 | ✅ 建议把「领域层约束表不得单点挂载」做成**静态结构检查**（约 20 行），并把 FR-064② 改为**可测形态**（变异测试可验证） |
| 源文件改动 | **无**（本轮纯只读） |

### 缺陷总表（截至第六轮 · QA 阶段收尾版）

| 编号 | 级别 | 状态 |
|---|---|---|
| BUG-01 | 阻塞 | ✅ FIXED（第二轮验证） |
| BUG-02 / 03 / 04 | 重要 | ⏸ 仍在（autoSave / 音频引擎 / 导出管线零测试） |
| BUG-05 | 次要 | ⏸ 仍在（`validation.ts` 69.35%） |
| BUG-06 / 07 | 次要 | ✅ FIXED / 已解决 |
| R2.3 `splitClip` 100ms | 次要 | ✅ 已确认符合规格（PM 裁定方案 1） |
| T3.3 fps 下限（D-003） | 重要 | ⚠️ PRD 已落（FR-038②），实现中 |
| T4.2 NEW-BUG-01 `durationMs` 不重算 | **阻塞** | ⚠️ **PRD 已落 FR-063（P0），实现中** |
| T4.3 NEW-BUG-02 transform/text 范围 | 重要 | ⚠️ PRD 已落 FR-064（P1） |
| T4.3 NEW-BUG-03/04 尺寸上限 | 次要 | ⚠️ PRD 已落 FR-065（P1） |
| T3.8.4 FR-018③ 7 项缺口 | P0 | ⚠️ PRD 已落 §9.8（i18n 键**已存在未接线**） |
| T3.5② `listFiles` 无调用方 / 无文件数上限 | 次要 | ⚠️ 待修（接线时） |
| T3.8.8 vite 临时产物污染 lint | 次要 | ⚠️ 待修（2 行） |
| **T5.3 FR-063⑥ 告警通道缺失** | **P0 落地障碍** | ⚠️ **本轮新发现，待 PM 补规格** |
| 低危批次（P2） | — | 未编号 |

### 最终智能路由判定：`NoOne`（维持）

**理由**：本轮为**规格澄清与落地可行性复核**，未发现新的源码缺陷。FR-063/064/065 已落 PRD 且要求准确（QA 撤回上一轮"不需要新 FR"的判断，接受 PM 更精确的定性）。唯一新增事项是 **FR-063⑥ 的落地可行性缺口** —— 这是**规格需补充**（告警通道与展示时机），不是源码缺陷，已请 PM 补入。

**待办归属**：
- **产品经理**：① 澄清 §9.10 决策一表 ③ 的措辞（建议按 T5.2 改写）② FR-063⑥ 补「告警经返回值传递、由调用方决定、仅导入路径展示」（T5.3）③ 统一 §3.10.1 与 §9.10 的编号对应关系 ④ 采纳或否决门禁判据 5/6（T5.5/T5.6）
- **工程师**：① FR-063/064/065 合并批次 9 项 ② FR-018③ 7 项 ③ 补 3 个新测试（导入重算 / 文字 clip 不重算 / outMs<=inMs 拒绝）④ `MaterialSourceConnector` + TASKS 修正 ⑤ `listFiles` 接线 + 文件数上限 ⑥ vite 产物忽略规则 ⑦ `check:prd-sync` 门禁脚本
- **QA（我）**：下一轮复核 FR-063/064/065 实现时，将用**变异测试**验证 FR-064②（移除 `deserialize` 或 `setClipProperty` 任一处的共用函数调用，测试必须失败）

---

## T5.8 QA 侧操作说明

本轮为**纯只读验证**，未修改任何源文件。校验方式：
```
grep -c "fixClipDuration" packages/app/src/domain/project/deserialize.ts              → 0
grep -c "MIN_EXPORT_FPS" packages/app/src/domain/export/exportPlan.ts                  → 0
grep -c '"fps": { "type": "number", "minimum": 1, "maximum": 240 }' schema/...          → 2
grep -c "tooShort" packages/app/src/i18n/locales/zh-CN.ts                                → 1（键已存在，PM 修正已核实）
find packages -name "*probe*" -not -path "*/node_modules/*"                              → 0
```
本轮创建 1 个临时探针测试文件（`probe_warn.test.ts`），**已删除**。
门禁复跑：**lint 0 / test 0（141 用例）/ typecheck 0**。

---

*第六轮规格澄清复核完 · QA 阶段收尾*