# ClipCut Web · V1.0 MVP 交接说明

> 生成时间：2026-10-23 09:40
> 工程根目录：`C:\Users\renji\WorkBuddy\2026-10-23-01-23-32`
> 状态：**功能骨架完成，QA 验证发现 2 个阻塞缺陷待修**

---

## 一、TL;DR

开源网页版视频剪辑软件（类剪映）的 V1.0 MVP 已完成架构设计、PRD、代码实现（233 个源文件 / 21 个测试文件 / 141 用例全绿），并经 QA 六轮独立验证。**当前代码可构建、可运行、可演示**，但 QA 挖出的 2 个阻塞缺陷（会导致用户数据静默丢失）尚未修复，详见第二节。

---

## 二、⚠️ 未完成项（下次开工从这里开始）

> **状态核查时间**：2026-10-23 09:45（工程师在收到我最后一封信后已继续推进，下面的"已落地"标记是逐文件 grep 实测的结果，非转述）

### ✅ 已落地（grep 实测确认）

| 项 | 证据 |
|---|---|
| **FR-063** `deserialize` 调 `fixClipDuration` | `deserialize.ts:26` import，`:214` `clip.durationMs = fixClipDuration(clip).durationMs`；`:201` 注释说明文字 clip 按 PRD 豁免 |
| **FR-064** 抽公共钳制函数 | 新建 `domain/timeline/valueRanges.ts`，导出 `clampNumber` / `clampToRange` / `clampNumericValues` / `clampClipNumericValues` / `clampProjectNumericValues`；`deserialize.ts:27` 已 import 复用 |
| **D-003** Schema fps 收紧 | `project.schema.json:80` → `{"minimum": 10, "maximum": 240}`（canvas.fps）、`:104` → `{"minimum": 10, "maximum": 60}`（export.fps）—— **两个字段都已覆盖** |
| **D-003** `MIN_EXPORT_FPS` | `exportPlan.ts:84` `= 10`，`:92` 钳制 |
| **FR-018③** 危险区选择器 | 新建 `domain/timeline/selectors.ts` + `selectors.test.ts` |
| 死代码清理 | `ClipConstraintError` 已删除（`invariants.ts` grep 0 命中） |
| API 导出补全 | `domain/timeline/index.ts` 4 个新 API 已导出（grep 命中 4） |
| 测试守门器 | `scripts/verify-test-count.mjs` |

### ❌ 仍需确认或补齐

**1. FR-063⑦ 告警通道（PM 第七轮刚落规格，实现未见）**
- `deserialize.ts` 中 grep `DeserializeResult` / `DeserializeWarning` / `warnings` → **0 命中**
- PM 规格：告警经**返回值**传递（纯函数，无 UI 副作用），由调用方决定是否展示，**仅导入路径展示**
- 改造面是 **4 个出口**（PM 新发现 `deserializeFromJson` 也返回裸 `ProjectDoc`），不是 3 个
- PM 明确拒绝「加回调参数」方案：回调是副作用，容易滑向"随手传个 toast 进去"；返回值是数据，在类型层面杜绝隐式 UI 行为

**2. `outMs <= inMs` 显式拒绝**
- `deserialize.ts` grep `outMs <= inMs` → **0 命中**，尚未实现
- 这是 FR-063 的第三项要求（结构性非法必须抛错，不让导入成功）

**3. `setExportSettings` 的 fps 钳制**
- `operations.ts:931` 仍是 `Object.assign(draft.settings.export, patch)`，无 fps 钳制
- Schema 已收紧可挡住导入路径，但**运行期通过 UI 改导出设置这条路径尚未收口**

**4. 契约测试**
- QA 要求的断言 `MIN_CLIP_DURATION_MS >= 1000 / MIN_EXPORT_FPS` —— 需确认是否已加，且需带**「取等是预期状态」注释**（PM 特别要求：否则后人可能误判为边界 bug 去"修正"它，反而破坏安全前提）
- FR-064② 建议改为**可测形态**，使 QA 能用变异测试验证（移除 `deserialize` 或 `setClipProperty` 任一处的共用函数调用，测试必须失败）

**5. `check:prd-sync` 门禁脚本**
- `scripts/` 下只有 `verify-test-count.mjs`，**`check:prd-sync` 未实现**
- 判据：① 每个 P0 FR 映射到非 completed 任务 ② 第 9 章新增 FR 条目有对应任务 ③ 统计表数量 == 正文实际条目数 ④ `*_RANGES`/`*_LIMITS` 约束表引用点 ≥2 且**必须包含 `deserialize.ts`**（检查结构而非条目，防复发）

**6. TASKS.md 补 T21/T22/T23**
- grep `^## T2[123]` → **0 命中**，三条任务未立项
- T21 FR-018③（标返工）/ T22 D-003 / T23 FR-063+064+⑦+测试+契约断言（PM 建议拆子项）

**7. FR-018③ 剩余项**
- i18n 键 `timeline.tooShort` 已存在但**组件层是否已接线待确认**（勿新建 `timeline.split.tooShort`）
- 按钮 disabled 是否已含**危险区判断**（此前只看 `selectedClipIds.length === 0`，不看播放头位置）
- 文案是否含**可执行替代动作**
- tooltip 是否已加

**8. 其余次要项**
- `MaterialSourceConnector` 接口定义（shared-types，约 15 行）
- TASKS.md T14 的 FR-012 覆盖声明修正
- vite 临时产物 `vitest.config.ts.timestamp-*.mjs` 忽略规则
- `listFiles()` 接线 + 文件数上限（接线时须同步实施）
- BUG-02/03/04：autoSave / 音频引擎 / 导出管线零测试
- BUG-05：`validation.ts` 覆盖率 69.35%（目标 80%）

### ⚠️ 未完成：QA 第七轮复核（agent 不可用，0 秒失败）

> ✅ **状态更新（PM 第七轮，PRD 现 1258 行）**：上述两项 PM 已落盘。
> - **FR-063⑦** 已写入 §9.10：告警经 `deserialize` **返回值**传递，保持纯函数，由调用方决定是否展示，**仅导入路径展示**。附 `DeserializeResult` 结构草案。
> - PM 额外发现 **`deserializeFromJson` 也返回裸 `ProjectDoc`**，改造面是 **4 个出口而非 3 个**（已写入 FR-063⑦-4）。
> - PM 明确拒绝了「加回调参数」备选：回调是**副作用**，容易滑向"随手传个 toast 进去"；返回值是**数据**，在类型层面杜绝隐式 UI 行为。
> - FR 编号无变化，仍 66 条 / P0 = 49，但**待办视图 P0 段现为 7 项**（新增「返回值结构改造」与「配套测试 3 个」两项工程动作）。
> - T23 承载 5 个 P0（FR-063 + FR-064 + ⑦ + 测试 + 契约断言），**建议在 TASKS.md 中拆为子项**便于跟踪。

### ⚠️ 未完成：QA 第七轮复核（agent 不可用，0 秒失败）

QA 工程师在第七轮启动时**直接不可用**（`Task agent software-qa-engineer is not available`），**该轮完全未执行**。以下三项**至今无人独立验证**：

| 待复核项 | 发起方结论 | 状态 |
|---|---|---|
| 工程师**否定** `redirectTempDir()` 方案（实测 EPERM 路径从系统临时目录变为 `packages/app/node_modules/.vite/tmp/`，结论是沙箱拒绝的是「worker 写新建随机目录」这个行为本身，与目录位置无关；并指出 QA 第四轮「20 文件全跑到」是**相关性不是因果性**） | 若成立，则 **QA 第四轮报告里「redirectTempDir 修复验证通过 ✅」是错误结论** | ❌ 未复核 |
| 守门器 `scripts/verify-test-count.mjs` 自身是否有漏检可能（它读 Vitest JSON 报告比对磁盘 glob，两个来源同时出问题会不会假绿） | 工程师自测：篡改报告删 1 条 → exit 1；真实 EPERM 场景 → exit 1 并指出「实际 19 / 应有 20」 | ❌ 未复核 |
| 工程师的**「上一轮 141 全绿是假绿」**（JSON 报告 `testResults` 实际只有 19 条、当时退出码为 0） | 若属实，说明**在守门器加它之前，QA 报告中所有「141 全绿」的结论都不可信** | ❌ 未留痕 |

**下次开工第一件事**：重启 QA 做第七轮复核。**若工程师的否定成立，必须就地标注第四轮报告里的错误结论**（不要静默删除——留痕比干净更重要）。

### 次要级（不阻塞 V1.0）

- BUG-02/03/04：autoSave / 音频引擎 / 导出管线零测试
- BUG-05：`validation.ts` 覆盖率 69.35%（目标 80%）
- `listFiles()` 无 UI 调用方 + 无文件数上限（接线时须同步实施）
- vite 临时产物 `vitest.config.ts.timestamp-*.mjs` 污染 lint
- `MaterialSourceConnector` 接口定义（shared-types，约 15 行）
- TASKS.md T14 的 FR-012 覆盖声明修正

---

## 三、已交付内容

| 产物 | 路径 | 说明 |
|---|---|---|
| 功能规划 | `视频剪辑软件功能规划文档.md` | v0.2，已按决策更新 |
| PRD | `docs/PRD.md` | 1149 行，66 条 FR（P0 49 / P1 12 / P2 5），§9.0.1 四条通用设计准则（L1 最高层级） |
| 架构设计 | `docs/ARCHITECTURE.md` | 78KB，14 张 Mermaid 图全部解析验证通过 |
| 任务分解 | `docs/TASKS.md` | 20 个任务 + 8 个批次（**T21/T22/T23 待补**） |
| QA 报告 | `docs/QA_REPORT.md` | 2167 行，六轮验证全过程留痕 |
| AI 接口文档 | `docs/ai/provider-api.md` | Provider 契约 + 空实现说明 |
| MCP 协议文档 | `docs/mcp/channel-protocol.md` | 15 个工具 + WS 通道协议 |
| 时序图 | `docs/diagrams/seq-1..5-*.mermaid` | 导入/渲染/播放/导出/MCP 调用 |

### 代码结构（233 个源文件）

```
packages/
├─ app/            React+Vite 主应用：platform/domain/state/services/render/hooks/components
├─ shared-types/   跨包类型：工程模型 / 时间工具 / AI 能力 / MCP 协议与 15 工具 Schema
├─ ai-provider-sdk/ AIProvider 接口 + 注册表 + 路由 + 3 个空实现（零厂商 SDK）
└─ mcp-server/     stdio 入口 + Server 工厂 + WS host + 15 工具
```

### 关键架构约束（QA 已 grep 实测通过）

1. **零上传**：domain 与 services/media 中无 fetch/XHR/WebSocket，产物层亦零命中
2. **分层隔离**：业务层零直接调用 localStorage/indexedDB/showOpenFilePicker
3. **零厂商 SDK**：ai-provider-sdk 依赖树仅 @clipcut/shared-types
4. **单向依赖**：app → {shared-types, ai-provider-sdk}，app **不依赖** mcp-server

---

## 四、启动方式

```bash
corepack enable pnpm     # 首次
pnpm install
pnpm dev                 # → http://127.0.0.1:5173
pnpm check               # lint + typecheck + test + build + schema:check
pnpm --filter @clipcut/mcp-server dev   # MCP Server（stdio，WS host :8765）
```

**门禁脚本**（六条）：`pnpm lint` / `typecheck` / `test` / `build` / `schema:check` / `check:prd-sync`（最后一条待实现）

---

## 五、⚠️ 已知环境问题

**Vitest worker 在本机沙箱下偶发崩溃丢测试文件**。根因：WorkBuddy FS shim 拒绝 worker 写新建随机目录（与目录位置无关，工程师已实测证伪 `redirectTempDir` 方案）。

**当前状态：不会伪装成绿灯**——`scripts/verify-test-count.mjs` 守门器会比对 Vitest JSON 报告与磁盘 glob 的测试文件数，不一致即 exit 1 并提示「本次结果不可信，漏跑了测试」。

> 注：该守门器在加它之前抓到过一次**假绿**（19/20 文件、退出码 0）。CI（ubuntu-latest）无此 FS shim，不受影响。

**其他未验证项**（本环境无浏览器媒体栈，需真机验证）：
- `mp4DecoderProvider`（mp4box + VideoDecoder + GOP 帧缓存）未经真实 MP4 端到端验证
- `webCodecsExporter` 逐帧渲染 + mp4-muxer 封装未经真实编码验证
- WSOLA 变速保音高需用 OfflineAudioContext FFT 实测断言
- Playwright e2e 已就位但未执行（需 `pnpm exec playwright install chromium`）
- 仓库尚未 `git init`

---

## 六、下次开工的推荐顺序

```
1. FR-063 剩余两项：outMs<=inMs 显式拒绝 + FR-063⑦ 告警通道（返回值传递，4 个出口）
2. FR-064② 改为可测形态 + 补契约测试（含「取等是预期状态」注释）
3. setExportSettings 的 fps 钳制
4. FR-018③ 剩余项（i18n 接线 / disabled 含危险区判断 / 可执行替代动作 / tooltip）
5. T21/T22/T23 立项 + check:prd-sync 门禁脚本（4 条判据）
6. QA 终验：① 复核第七轮三项（redirectTempDir 否定 / 守门器 / 假绿留痕）
        ② 用变异测试验证 FR-064② 防线真实有效
        ③ 验证 FR-063 修复后既有测试期望值是否变化
```

---

## 七、这套流程沉淀出的通用准则

写在 `docs/PRD.md` §9.0.1（L1 最高层级，约束尚未写出的决策）：

1. **能在入口拦住的，不要留到管线里静默失败** —— 约束了 D-001 / D-003 / FR-018③ / FR-063
2. **区分「结构性非法」与「可自动修正的偏差」** —— 判据是「能否由系统唯一确定地修正」，而非「有多严重」
3. **同一约束在所有入口必须一致，且需契约测试守护** —— 推论：UI 层的限制不是约束，只防误操作，外部输入可完全绕过
4. **静默即等于关闭警报** —— 不可见等于不存在，工程侧与流程侧通用
