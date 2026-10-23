# QD视界 · 续开工交接说明（v3）

> 更新时间：2026-10-23 14:30
> 工程根目录：`C:\Users\renji\WorkBuddy\2026-10-23-01-23-32`
> 状态：**✅ V1.0 MVP 全部 P0 闭环，可继续开发**
> git：基线 `0386317` → 本轮成果 `a7ab4e4`（工作区干净）

---

## 一、TL;DR

你之前做的这个项目**完全可以用**，本轮已把**最后一个 P0 缺口闭环**，五条门禁 + e2e 全绿。

| 维度 | 接手时（09:40） | 现在（14:30） |
|---|---|---|
| 用例数 | 141（**且不可信**，见下） | **344**（337 + 7），守门器集合比对确认 |
| 测试文件 | 21 | **32**（app 31 + shared-types 1） |
| P0 实现缺口 | 2 个阻塞缺陷 + FR-063⑦ | **0** |
| e2e 浏览器验证 | 从未执行 | **3/3 通过** |
| git 版本管理 | 无 | 已有 2 个提交 |

---

## 二、本轮做了什么

### 1. FR-063⑦ 导入路径告警通道（P0 唯一缺口，已闭环）

**决策依据**：`docs/FR063-7-decision.md`（27KB，含 8 个被否决方案的理由）

| 情形 | 处理 | 告知用户 |
|---|---|---|
| `outMs <= inMs` | 显式抛错，拒绝导入 | ✅ 错误信息 |
| `durationMs` 与公式不符 | 重算为正确值，不阻断导入 | ✅ **仅导入路径**单条合并 toast |
| 其他数值越界 | 静默钳制到合法区间 | ❌ 仅记录在数据通道 |

**关键实现决策**：
- `deserialize` 返回类型直接改为 `DeserializeResult`（**单一入口**，不存在不带告警的平行入口）—— 类型层面杜绝绕过告警通道
- 钳制函数用**可选参数** `ClampOptions { changes?, pathPrefix? }` 回报改动 —— 既有调用点零改动，`setClipProperty` 路径不传收集器
- 新增 `components/project/importWarning.ts` —— 把「只呈现 `duration-recomputed`」抽成纯函数，**组件与测试共用同一实现**，避免「测试复制品与真实代码不一致」
- ⚠️ `doc` 上**绝不挂** `warnings` 字段 —— `serialize.ts` 的 `canonicalObject()` 保留未知键 + Schema `additionalProperties: true`，挂上去会被写进用户工程文件

### 2. QA 第七轮复核（此前因 agent 不可用而 0 秒失败，本轮补上）

| 复核项 | 结论 |
|---|---|
| ① `redirectTempDir` 否定是否成立 | **成立** —— 用**隔离 worktree 做 A/B 对照实验**坐实「第四轮把相关性误当成因果性」。已在第四轮就地勘误留痕（原结论保留不删） |
| ② 守门器是否可能假绿 | **确有漏检，已修复** —— 初版只比「数量」，实测 S2/S3 两类场景 `exit 0` 假绿。改为**集合比对** + 按包对齐 `include` 规则。S3（陈旧报告）已封堵，**S2 诚实披露为已知边界**（需独立期望清单，超出本轮范围） |
| ③ 历史「N 用例全绿」结论留痕 | **方法论上不可信** —— 守门器引入前无法自证完整。已逐行定位受影响结论并加勘误段。**明确口径**：被掩盖的是「少跑了」，不是「有缺陷却显示通过」 |
| 附加：FR-064② 变异测试 | **发现真实缺口** —— 移除 `setClipProperty` 的钳制调用后测试仍全绿（变异存活）。已补 `clipPropertyClamp.test.ts`（7 用例，含「两条路径对 15 条约束结果完全一致」），复测变异被杀 |

### 3. 顺带修的真实 bug

`packages/app/src/domain/project/validation.ts` —— 越界错误提示完全误导：

- **参数名错**：Ajv **v8** 的 `params.comparison` 是**操作符**（`">="`），`params.limit` 才是**阈值**（`10`）
- **文案方向错**：`minimum` 分支写「不能大于」、`maximum` 分支写「不能小于」—— 正好互换

修复前显示「字段 /settings/canvas/fps 不能小于 **>=**」，修复后「**不能小于 10**」。并补齐 `exclusiveMinimum`/`exclusiveMaximum` 分支。

### 4. 测试覆盖补齐（BUG-02/03/04/05）

新增 8 个测试文件：`autoSave` / `audioEngine` / `webCodecsExporter` / `mediaRecorderExporter` / `audioExporter` / `validation` / `clipPropertyClamp` / `deserializeWarnings` / `importWarning`

---

## 三、门禁现状（本次亲自跑，非转述）

| 门禁 | 结果 |
|---|---|
| `pnpm lint` | ✅ 0 error |
| `pnpm typecheck` | ✅ 0 error |
| `pnpm test` | ✅ **337 + 7 = 344 用例全绿**，31 + 1 个测试文件 |
| 守门器 | ✅ **集合比对**通过：app 31/31、shared-types 1/1，集合完全一致 |
| `pnpm build` | ✅ 四包构建通过 |
| `node scripts/check-prd-sync.mjs` | ✅ 6 条判据通过 |
| `pnpm exec playwright test` | ✅ **3/3 通过**（40.9s） |

---

## 四、剩余事项（均不阻塞 V1.0）

### 🔴 需真机验证（本环境无法覆盖）

| 项 | 说明 |
|---|---|
| `mp4DecoderProvider` 端到端 | mp4box + VideoDecoder + GOP 帧缓存，需真实 MP4 |
| `webCodecsExporter` 真实编码 | 逐帧渲染 + mp4-muxer 封装 |
| WSOLA 变速保音高 | 需 `OfflineAudioContext` FFT 实测断言 |
| `MediaRecorder` 真实录制 | 兜底导出路径 |

> 这些的**分支选择逻辑、参数校验、错误分支已补齐测试**，但真实媒体栈必须人工用素材验证。

### 🟡 已知边界与次要项

| 项 | 状态 |
|---|---|
| 守门器 S2 场景 | 某测试文件**真的从磁盘消失**时守门器无从得知（需独立期望清单，如 `git ls-files` 快照） |
| `listFiles()` 零调用方 | 已实现于 `WebPlatformBridge.ts:162`，UI 无入口。接线时须同步实施单层文件数上限（PRD §9.2 要求如 2000）+ 超限告警 |
| 告警明细列表 | 本期只给数量，不逐条列举（列入 P2） |
| `value-clamped` UI 呈现 | 本期不呈现（记录但不打扰），若需分别汇总建议升级为两条 toast（P2） |
| `exportController.ts` 顶层编排 | 导出管线的**模块内分支**已覆盖，但「有 WebCodecs 走哪条、否则走哪条」的**顶层编排**尚未单测（可补 `exportController.test.ts`） |
| `toHint` 部分关键字 | `minLength`/`maxLength`/`maxItems`/`multipleOf` 仍走兜底分支，提示夹着英文 Ajv 原文 |

### 🟢 环境坑（沿用，仍然有效）

- WorkBuddy 沙箱 FS shim 拒绝 Vitest worker 写新建随机目录 → 偶发丢测试文件且**退出码仍为 0**
- 守门器已从「比数量」升级为「比集合」，能捕获陈旧报告与规则错配
- `pnpm test:coverage` 全量在本机会挂起（Windows EPERM）；`pnpm check` 聚合超 580s 会 SIGTERM → **拆开单跑各条正常**
- ⚠️ **测试里的真实等待是 CI 间歇性红灯的常见来源** —— 本轮已实测到一例：
  `mediaRecorderExporter.test.ts` 因生产代码逐帧循环的 `await new Promise(setTimeout)`（12 帧 ≈ 400ms 真实挂钟），
  在高负载下被拉长到超过 Vitest 默认 5s timeout → **整文件用例集体超时**（单独跑必过）。
  解法是改用**假时钟**（`vi.useFakeTimers()`），零真实等待，该文件测试耗时降到 77ms。
  **新增含真实等待的测试时，请优先用假时钟。**

---

## 五、续做推荐顺序

```
1. git init 已完成 → 配置 GitHub 远程仓库（开源计划）
2. listFiles() 接线 + 文件数上限 + 超限告警（FR-012 剩余）
3. 真实素材验证导出管线（WebCodecs 主路径 / MediaRecorder 兜底）
4. 守门器 S2 封堵：引入 git ls-files 作为独立期望清单
5. V1.5 方向：AI Provider 真实实现（当前 3 个 Provider 为空实现）+ MCP Server 对接
```

---

## 六、文档索引

| 文档 | 内容 |
|---|---|
| `docs/RESUME-2026-10-23.md` | 本轮完整体检报告（更详细的实测证据） |
| `docs/FR063-7-decision.md` | FR-063⑦ 完整裁决记录 + 8 个被否决方案 |
| `docs/QA_REPORT.md` | QA 七轮验证全过程（含第七轮复核与勘误留痕） |
| `docs/PRD.md` | 产品需求（66 条 FR，P0 49） |
| `docs/ARCHITECTURE.md` | 系统架构（14 张 Mermaid 图） |
| `docs/TASKS.md` | 任务分解（T1~T23） |

---

## 七、这套流程沉淀的准则（写在 PRD §9.0.1，L1 最高层级）

1. **能在入口拦住的，不要留到管线里静默失败**
2. **区分「结构性非法」与「可自动修正的偏差」** —— 判据是「能否由系统唯一确定地修正」，而非「有多严重」
3. **同一约束在所有入口必须一致，且需契约测试守护** —— UI 层的限制不是约束，外部输入可完全绕过
4. **静默即等于关闭警报** —— 不可见等于不存在，工程侧与流程侧通用

> 本轮新增一条实践教训：**告警发了但内容是空的，等于没发**（`validation.ts` 的「不能小于 >=」即此例）。
