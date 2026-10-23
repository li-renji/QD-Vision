# FR-063⑦ 规格裁决记录 · 导入路径告警口径

> **性质**：需求与规格层面的裁决（PM 职权），**不含实现代码**。
> **裁决人**：许清楚（产品经理 / Alice）
> **日期**：2026-10-23
> **裁决对象**：PRD §9.10 决策一内部的**三处自相矛盾表述**（详见下表）
> **落盘位置**：`docs/PRD.md`（就地修订）+ 本文件（决策过程留痕）
> **关联任务**：`docs/TASKS.md` T23（FR-063 + FR-064 导入路径派生量重算 + 公共钳制函数）

---

## 一、待裁决的矛盾（三处，逐一定位）

| # | 位置 | 原文要点 | 冲突对象 |
|---|---|---|---|
| **甲** | PRD §9.10 决策一 · 三类数据分类表（**L1018**） | `durationMs` 与公式不符 → 重算为正确值 → **「✅ 在导入路径告知（见 FR-063⑦）」** | 与「乙」直接对立 |
| **乙** | PRD §9.10 决策一 · 末尾「⚠️ 本节已修订」备注（**L1100**） | 「经复核，**`durationMs` 重算同样应静默** —— 用户无需感知系统替其修正了派生量」 | 与「甲」直接对立 |
| **丙** | PRD §9.10 决策一 · 「措辞修订说明」（**L1057**） | 「重算 → 不阻断导入（③）｜**告警 → 必须告知用户（⑥的告警分支）**」 | ⑥ 的分类内容是「静默钳制 → ❌ 不告知」，**⑥ 根本没有告警分支**；告警分支是 ⑦。属**编号错引** |

**三处打架的实质**：分类表（甲）要求 `durationMs` 告警，备注（乙）要求静默，而修订说明（丙）把「告警」挂到了一个明确声明「不告知」的分支上。**同一节内部无法自洽**，实现者按任何一处写都会与另外两处冲突。

**裁决依据的效力层级**（PRD §9 效力声明）：

| 层级 | 内容 | 效力 |
|---|---|---|
| L1 准则级 | §9.0.1 通用设计准则（4 条） | **最高**，与任何层级冲突时一律以 §9.0.1 为准 |
| L2 决策级 | §9.1 ~ §9.14 | 次于 L1；与 L1 冲突时**以 L1 为准并须修订该决策**（不豁免） |
| L3 基础规格级 | 第 0~8 章（FR 表格等） | 最低 |

---

## 二、裁决（一句话口径）

> **`durationMs` 重算产生告警（`code: 'duration-recomputed'`），仅在「用户主动导入外部工程文件」路径以**单条合并 toast** 呈现；数值钳制产生告警（`code: 'value-clamped'`）但**不在 UI 呈现**（仅作数据/断言通道）。告警是**数据**（`DeserializeResult.warnings`），不是 UI 行为；`deserialize` 保持纯函数。**

---

## 三、四个待答问题的逐项裁决

### 3.1 `durationMs` 重算是否产生 warning？`code` 是什么？

**是。`code = 'duration-recomputed'`。**

**理由（逐条对应 L1 准则）：**

| # | 依据 | 说明 |
|---|---|---|
| 1 | **准则四**（L1）把本案列为**反例本身** | §9.0.1 准则四的「静默处理掩盖了本该暴露的问题」清单里，第一条就是「`deserialize` **静默接受**不一致的 `durationMs` → 用户直到导出后才发现问题，**且无从判断工程是否被改动**」。前半句由「重算」解决，**后半句只能由「告警」解决** —— 重算之后用户依然不知道工程被改过。 |
| 2 | **准则四推论**「任何『用户可能因此损失内容或时间』的情形，必须显式告知」 | `durationMs` 不符 → `meta.durationMs` 被重算 → **工程总时长被改写**。PRD FR-063① 验收标准原文即「工程总时长不膨胀」。用户可能导出一个时长完全不同的成片 —— 这是**实打实的「损失内容/时间」**，准则四要求显式告知。 |
| 3 | **准则二推论**的适用边界是**常规路径**，而非导入路径 | 准则二「不要为『系统已自动修好』的事打扰用户」，其具体化表述是「用户导入一个**正常工程**（可能来自旧版本或其他工具，数值略有偏差）却看到**一堆警告**，体验很差」。而**本应用自己写出的文件必然自洽** —— PRD §9.13 已实测三个 fixture 的「不一致数」**全部为 0**。因此导入路径上的 `durationMs` 不符**永远不是「正常工程略有偏差」，而是异常信号**。同时，常规路径（`loadProject` / `deleteProject`）恰恰是 PRD 规定**不展示**的两条 —— **噪音担忧在源头就被消除了**，准则二的适用场景根本不会触发告警。 |
| 4 | 确定性 ≠ 无感 | 准则四推论说「静默只适用于『系统已确定性地修好』的情形」。「确定性」保证的是**修正值正确**，不保证**修正对用户无感**。`scale=1000→20` 是外观微调；`durationMs=999999→3000` 是**工程时长的量级变化**，用户一眼能看出异常却不知其因。 |

**因此**：PRD **L1100 的「修订备注」（乙）判定为早前版本残留、修订时漏改，作废**。依据 §9 效力声明，L2 决策与 L1 准则冲突时以 L1 为准，且该决策「须修订」——本次即完成该修订。

> **备注（丙）的编号错引同时修正**：「⑥的告警分支」→「⑦」。⑥ 是「其他字段钳制 → 静默钳制 → ❌ 不告知」，**⑥ 没有告警分支**；告警分支是 ⑦。

---

### 3.2 `value-clamped`（数值钳制）是否产生 warning？这个 `code` 还要不要存在？

**存在，且产生 warning；但不在 UI 呈现。**

**裁决要点：分类表第 3 行的「❌ 不告知」是 **UI 层判定**，不是「不记录」判定。**

| # | 依据 | 说明 |
|---|---|---|
| 1 | 准则四「静默即等于关闭警报」 | 若钳制连**数据通道**都不留，等于把警报关掉 —— 这正是准则四所禁止的形态。PRD §9.10 决策二已实测这批值会造成「片段视觉消失」「画布全黑」「行距塌缩」，**它们是被修复的真问题，不是「没问题」**。 |
| 2 | FR-064 需要可断言的落地证据 | FR-064 验收标准②要求「可由变异测试验证：移除其中任一处的调用，测试必须失败」。要断言「导入路径**确实**调用了钳制」，就需要钳制函数**回报它改了什么**。 |
| 3 | 「与 `setClipProperty` 既有行为一致」的正解 | 一致的是**约束**（同一张范围表、同一函数），**不是可观测性**。`setClipProperty` 是用户亲手操作、结果即时可见；导入是用户看不见的静默改写。 |
| 4 | 未来可升级成本极低 | 若产品日后决定把钳制升级为「告知」，只需改 UI 的过滤条件，**不动数据契约**。 |

**但为什么不呈现？** 因为分类表第 3 行的判断是对的：`scale=1000` 这类值**没有合法意图**（上限 20），钳制到 20 是标准容错；而 `durationMs` 不符是**文件自相矛盾**，性质不同。二者**同属一类 code 但不同严重级**，所以：

- **`value-clamped` 留在 `warnings` 里**（可观测、可断言、不持久化）。
- **UI 只呈现 `duration-recomputed`** —— 这条过滤规则是**强制**的，见 §四.4。

> 若未来两者需分别呈现，建议升级为「按 code 分别汇总的两条 toast」，但**本期不做**（列入 P2）。

---

### 3.3 告警是「数据」还是「UI 行为」？

**是数据。`deserialize` 保持纯函数（不碰 UI、不产生副作用、不 toast）。**

PRD **L1077 的 ⑦-1 口径确认仍然有效**，无需修订：

| 判据 | 裁决 |
|---|---|
| 告警通道 | **返回值**（`DeserializeResult.warnings`），**不是**回调、不是全局事件总线、不是 toast |
| `deserialize` 副作用 | **零**：不 toast、不写 DOM、不读写 IndexedDB、不改全局状态 |
| 谁决定是否展示 | **调用方**。`deserialize` 只负责**如实记录**发生了什么修正 |
| 回调方案（QA 备选 B） | **仍否决**，理由不变：回调是副作用，容易在实现中滑向「随手传个 toast 进去」，而那正是骚扰问题的成因 |

**L1096 的「类型层面杜绝隐式 UI 行为」在本裁决下如何落地**：见 §四.2 的**「单一入口」裁决** —— 承载告警的返回类型是 `deserialize` 的**唯一**返回类型，不存在「另一个不带告警的平行入口」，因此从类型上就不可能把告警通道绕过去。

---

### 3.4 `warnings` 里到底装什么，才能同时满足「不骚扰正常用户」和「异常场景必须可观测」？

**答案：`warnings` 只装「本次加载中被系统自动改写的数据事实」——两类 code，且每一条都对应一次真实的数值改写。「不骚扰」由「只在 import 路径 + 单条合并 toast + 只呈现 `duration-recomputed` + 1ms 容差」实现；「可观测」由「warnings 始终被如实填充且可被测试断言」实现。**

| 装 | 不装 |
|---|---|
| `duration-recomputed` —— 派生量与权威字段不符、被重算 | ❌ 「校验通过」「未发现问题」这类**正常事件**（否则正常工程也一片噪音） |
| `value-clamped` —— 数值越界、被钳制到合法区间 | ❌ **未发生修正**的空记录（绝不占位） |
| | ❌ 用户可见的文案（文案是 UI 层的事，领域层不碰 i18n —— 沿用 T21「领域层不 import i18n」的既有口径） |

**产生规则（精确，见 §四.3）**：

1. `duration-recomputed`：**仅当** `|expected − actual| > DURATION_RECOMPUTE_TOLERANCE_MS`（**= 1**）时产生。
   - 1ms 及以内的差异视为**取整噪声**，不告警 —— 防止将来公式微调导致全量文件刷屏（这是「不骚扰」在数据层的最后一道闸）。
   - 文字 clip（`assetId === null`）`fixClipDuration` 原样返回 → `expected === actual` → **天然不产生**，与 FR-063② 自洽。
2. `value-clamped`：钳制**确实改变了值**时才产生（值在区间内 → 不产生）。
3. **排序**：`duration-recomputed` 在前、`value-clamped` 在后；组内按 track 顺序 → clip 顺序 → 字段路径字典序。**确定性**，保证 PRD L1098 的示例断言 `warnings[0].code === 'duration-recomputed'` 成立。

---

## 四、可直接实施的接口契约

### 4.1 类型定义与导出路径

**定义位置**：`packages/app/src/domain/project/deserialize.ts`（与 `deserialize` 同文件，纯领域层，零 DOM / 零 IndexedDB / 零 i18n）。

```ts
/** 告警类型（FR-063⑦）。 */
export type DeserializeWarningCode = 'duration-recomputed' | 'value-clamped';

/** 单条告警 —— 描述「本次加载中被系统自动改写的一处数据」。 */
export interface DeserializeWarning {
  /** 告警类型。 */
  code: DeserializeWarningCode;
  /** 受影响的 clip id；工程级告警（`meta.durationMs` / canvas / export / track）为 `undefined`。 */
  clipId?: string;
  /** 受影响字段路径：clip 级为 `'durationMs'` / `'transform.scale'`；工程级为 `'meta.durationMs'` / `'settings.canvas.width'` / `'track.height'`。 */
  field: string;
  /** 系统采用的值（重算结果 / 钳制结果）。 */
  expected: number;
  /** 工程文件中的原值。 */
  actual: number;
}

/** 反序列化结果（FR-063⑦）。 */
export interface DeserializeResult {
  /** 反序列化后的工程文档（**不含** warnings —— 见 §四.5 的隔离约束）。 */
  doc: ProjectDoc;
  /** 本次加载中被系统自动修正的不一致项；无修正时为空数组。 */
  warnings: DeserializeWarning[];
}
```

**导出路径**：`packages/app/src/domain/project/index.ts` 必须补齐（当前只导出了 `deserialize`）：

```ts
export {
  deserialize,
  deserializeFromJson,
  type DeserializeResult,
  type DeserializeWarning,
  type DeserializeWarningCode,
} from './deserialize.js';
```

> `DeserializeResult` **不进入 `packages/shared-types`** —— 它是应用内部领域概念，`shared-types` 只放跨端数据契约。

### 4.2 最终签名

```ts
export function deserialize(json: unknown): DeserializeResult;
export function deserializeFromJson(text: string): DeserializeResult;
```

**「单一入口」裁决（强制）**：`deserialize` 的返回类型**就是** `DeserializeResult`，**不存在**「另一个返回裸 `ProjectDoc` 的平行入口」。理由：准则四「静默即等于关闭警报」的极端形态就是「返回值里根本没有告警通道」；PRD L1096 明确推崇「在类型层面就杜绝了隐式 UI 行为」。

**迁移成本（已实测，供排期）**：

| 项 | 数量 | 说明 |
|---|---|---|
| 生产调用点 | **3** | 见 §四.3 |
| 测试调用点（取值型） | **85** | `packages/app/src/**/*.test.ts`，机械改为 `const { doc } = deserialize(...)` |
| 测试调用点（抛错断言型） | **3** | `expect(() => deserialize(...)).toThrow()` —— **无需改动**（签名返回类型变化不影响） |
| `deserializeFromJson` 调用点 | **0** | 全仓无调用方 → 改签名**零成本** |

> 85 处取值型调用点**全部由 TypeScript 编译器逐个定位**（返回类型不再匹配 `ProjectDoc` 会直接报错），不存在「改漏了但测试还是绿」的可能。`pnpm typecheck` 必须 0 error、`pnpm test` 必须全绿（当前基线：23 个测试文件 / 161 用例）。

### 4.3 四个出口的改造方式（强制）

| # | 出口 | 现状 | 改造后 | 展示告警 |
|---|---|---|---|---|
| **1** | `packages/app/src/components/project/ImportProjectDialog.tsx:59` | `doc = deserialize(json)` | `const { doc, warnings } = deserialize(json)` | ✅ **应展示**（唯一展示点） |
| **2** | `packages/app/src/services/storage/projectRepo.ts:57` `loadProject` | `return deserialize(...)` | `const { doc } = deserialize(...)`；**丢弃 `warnings`** | ❌ 不展示 |
| **3** | `packages/app/src/services/storage/projectRepo.ts:75` `deleteProject` | `const doc = deserialize(...)` | `const { doc } = deserialize(...)`；**丢弃 `warnings`** | ❌ **绝对不展示** |
| **4** | `packages/app/src/domain/project/deserialize.ts:227` `deserializeFromJson` | `return deserialize(JSON.parse(text))` | **返回 `DeserializeResult`**（PRD L1080 的 ⑦-4 口径确认） | ❌ 本函数不展示 |

**关于出口 4 的成本说明**（任务书要求明确）：

- `deserializeFromJson` **全仓零生产调用方、零测试调用方**（实测 grep 确认）→ **改签名零迁移成本**。
- 它当前也**未**从 `domain/project/index.ts` 导出 → 本次一并补上导出。
- PRD L1080 的 ⑦-4「`deserializeFromJson` 与 `deserialize` 保持一致的返回结构」**确认仍然有效**，且「一致」的含义被本裁决收紧为：**返回类型完全相同**（不是「结构相似」）。

**关于出口 2 / 3 丢弃 `warnings` 的合法性**：

- `loadProject` 读的是**本应用自己写入**的工程 → 数据本应自洽，一旦出现 warning 说明**本应用有 bug**，这属于开发期可观测问题，不是用户侧问题。
- `deleteProject` 仅为**提取 blobKey** 而解析整份工程 → 它连 `doc` 都只用了 `assets` 一角，任何提示都是纯噪音。**这是「用户每次删工程都莫名弹提示」的直接来源，必须杜绝。**

### 4.4 UI 呈现（强制）

| 项 | 规定 |
|---|---|
| 呈现位置 | `ImportProjectDialog.tsx` 导入成功后的 toast 区（与既有 `project.import.ok` / `project.import.missingAssets` 并列） |
| 呈现形态 | **单条** toast，`variant: 'warning'` |
| **多条如何合并** | **合并为一条**，文案含**数量** `{count}`，**不逐条列举**（逐条列举 = 视觉噪音，且 toast 会被后续 toast 顶掉） |
| **过滤规则（强制）** | 只统计 `warnings.filter((w) => w.code === 'duration-recomputed').length`。**`value-clamped` 不得进入 UI** —— 这条过滤是分类表第 3 行「❌ 不告知」的落地，写成显式 `filter` 而非「遍历全部 warnings」 |
| 发出顺序 | **告警 toast 先发**（它解释的是「工程内容被改过」），随后是既有的 `missingAssets` / `ok` 分支。**既有分支逻辑一字不改** |
| 时长 | 用 `toast()` 默认时长，不单独指定 |
| 明细列表 | **本期不做**（列入 P2） |

**i18n 键**（`packages/app/src/i18n/locales/zh-CN.ts` 与 `en-US.ts` **必须成对新增，键集完全一致**）：

| 键 | zh-CN | en-US |
|---|---|---|
| `project.import.dataAdjusted` | `工程文件存在 {count} 处不一致数据，已自动修正（时长已按素材区间重算）。` | `The project file had {count} inconsistent value(s); they were corrected automatically (durations recomputed from source ranges).` |

**键名风格**沿用既有 `project.import.*` 命名族（`missingAssets` / `tooNew` / `invalid` / `ok`），采用**动宾短语 + 无句号**风格，与 `project.import.missingAssets` 一致。

**为什么是 `dataAdjusted` 而不是 `warning`/`repaired`**：`dataAdjusted` 同时覆盖「重算」与「钳制」两类修正的**语义**，且不预设严重级；将来若增加第三类 code，键名不必改。

### 4.5 ⚠️ 硬约束：`warnings` 不得进入 `doc`（已被实测排除的方案）

**`DeserializeResult.doc` 必须是纯 `ProjectDoc`，其上不得挂载 `warnings` 字段。**

**实测依据（本裁决期间核查）**：

- `packages/app/src/domain/project/serialize.ts` 的 `canonicalObject()` 明确采用「**已知键优先 + 未知键保留**」策略 → 若 `doc` 上多出 `warnings` 键，**会被原样写回工程 JSON**。
- `schema/project.schema.json` 顶层 `additionalProperties: true` → 该污染**不会被 Schema 拒绝**，会一路持久化并反复读回。

**后果**：每个用户保存的工程文件里都会永久残留一段 `warnings` 数组 —— 这是**用户数据污染**，不是风格问题。故「doc 内嵌 warnings」这一形态（`ProjectDoc & { warnings }`）**被正式排除**。

---

## 五、被否决的备选方案

| # | 方案 | 否决理由 |
|---|---|---|
| **A** | **保留 L1100 备注口径：`durationMs` 重算一律静默，不产生 warning** | 与 L1 准则四**直接冲突** —— 准则四把「`deserialize` 静默接受不一致的 `durationMs`」明列为反面实例，且要求「用户可能因此损失内容或时间的情形必须显式告知」。工程总时长被改写正属此类。**否决。** |
| **B** | **`warnings` 只装 `duration-recomputed`，删掉 `value-clamped` 这个 code** | 钳制是**真问题**（§9.10 决策二实测会造成画布全黑 / 片段消失）。删掉它等于关闭警报（准则四），且 FR-064 的变异测试失去断言依据。**否决。** |
| **C** | **`value-clamped` 既产生 warning 又在 UI 呈现** | 与分类表第 3 行「❌ 不告知」冲突，且会造成「导入一个正常工程看到一堆警告」—— 准则二推论明令禁止。钳制属常规容错，不该打扰。**否决。** |
| **D** | **告警走回调参数**（QA 备选方案 B） | 回调是副作用，实践中会滑向「随手传个 toast 进去」，正是骚扰问题的成因。**否决（沿用 PRD 既有结论，本裁决复核后维持）。** |
| **E** | **`deserialize` 在内部直接 toast** | 同 D，且违反「`deserialize` 保持纯函数」。**否决。** |
| **F** | **`doc` 内嵌 `warnings`（`ProjectDoc & { warnings }`）** | 会把 `warnings` **写进用户保存的工程文件**（`canonicalObject` 保留未知键 + Schema `additionalProperties: true`）→ 用户数据污染。**否决（已实测，见 §四.5）。** |
| **G** | **保留 `deserialize` 裸签名，另加一个 `deserializeWithReport()` 并行入口** | 类型上仍存在「可以完全绕开告警通道」的路径，与准则四「静默即等于关闭警报」的精神相悖；且让「我该调哪个函数」变成新的歧义源。**否决**，改由「单一入口 + TypeScript 逐点定位迁移」解决。 |
| **H** | **任何差异都告警（不加 1ms 容差）** | 将来若时长公式微调（如 `round` 改 `floor`），全量工程文件都会刷屏告警 —— 正是准则二禁止的「一堆警告」。**否决**，保留 1ms 容差。 |

---

## 六、对现有文档的修订清单

| 文件 | 位置 | 修订内容 |
|---|---|---|
| `docs/PRD.md` | §3.10.1 FR-063 行 验收标准 ⑥ | 改为与本裁决一致（返回值结构 / 两个 code / 4 个出口 / 单条合并 toast / 1ms 容差） |
| `docs/PRD.md` | §9.0.1 准则二 表格与推论 | 拆分「处理方式轴」与「告知轴」，消除 L1 内部的「静默重算」与分类表的张力 |
| `docs/PRD.md` | §9.0.1 准则四 | 追加「本裁决已把『静默接受 durationMs』的残余问题收敛到『告警通道 + 仅导入路径展示』」的指向 |
| `docs/PRD.md` | §9.10 决策一 分类表 | 第 2 行补「1ms 容差 + 单条合并 toast」；第 3 行补「记录但不呈现」 |
| `docs/PRD.md` | §9.10 逐条要求 ⑦ | 「建议的返回结构（非强制）」升级为**强制契约** |
| `docs/PRD.md` | §9.10 措辞修订说明 | 「⑥的告警分支」→ **「⑦的告警分支」** |
| `docs/PRD.md` | §9.10 L1100 矛盾备注 | 标注为**已被本裁决取代**并说明理由（不静默删除 —— 删除会让后人看不出这里曾经改过） |
| `docs/PRD.md` | §9.7 待办视图 | 第 6 项「3 个调用点」→ **4 个出口**；P1 段移除已满足项（见 §八） |
| `docs/PRD.md` | §9.13 动作表 18 / 配套测试 | 「3 个调用点同步」→ 4 个出口；配套测试补 T4/T5/T6 |
| `docs/TASKS.md` | T23 | 补 FR-063⑦ 的实现要点、4 个出口改造、i18n 键、测试迁移量、验收标准 |

---

## 七、留给工程师的实现要点（规格层，不含代码）

1. **快照必须在改写前取**：`durationMs` / `meta.durationMs` 的原值必须在被 `fixClipDuration` / `computeProjectDuration` 覆盖**之前**读出，否则无从比较。
2. **钳制需回报改了什么**：`valueRanges.ts` 的 `clampNumericValues` / `clampClipNumericValues` / `clampProjectNumericValues` 增加**可选**的收集参数（形如 `changes?: ClampChange[]`），**不传时行为完全不变** → `setClipProperty` / `setCanvasSettings` / `setExportSettings` 的现有调用点**零改动**，FR-064 的「两条路径共用同一函数」契约保持成立（判据 6 仍须通过）。
3. **`ClampChange`** 建议形状：`{ path: string; actual: number; expected: number }`，与 `DeserializeWarning` 同构（`deserialize` 负责把 `ClampChange` 映射为 `DeserializeWarning` 并补上 `clipId` / `code`）。
4. **容差常量**：`DURATION_RECOMPUTE_TOLERANCE_MS = 1`，与 `expectedDurationMs` 同文件（`packages/app/src/domain/timeline/invariants.ts`），导出供测试断言。
5. **`deserialize` 保持纯函数**：不得引入任何 DOM / IndexedDB / i18n / toast 依赖；领域层不 import i18n（沿用 T21 口径）。
6. **`deserializeFromJson` 同步改签名**并从 `domain/project/index.ts` 一并导出。

---

## 八、剩余 P1 项复核结论（本轮实测）

| # | 待办项（PRD §9.7 P1 段） | 实测结论 | 处置 |
|---|---|---|---|
| 8 | `MaterialSourceConnector` 接口类型定义 | ✅ **已存在** —— `packages/shared-types/src/connectors.ts:64`，接口含 `id` / `name` / `requiresApiKey` / `isConfigured()` / `search()` / `fetchMaterial()` / `dispose?()`，与 FR-012①「定义接口」相符 | **从待办移除**（FR-012① 已满足） |
| 9 | `TASKS.md` T14 覆盖声明修正（FR-012② → ①） | ✅ **已完成** —— `docs/TASKS.md:790` 现为 `FR-008、FR-010 ①、FR-012 ①（MaterialSourceConnector 接口定义）` | **从待办移除** |
| 11 | **FR-065** `canvas.*` / `track.height` 补 Schema 上限 | ✅ **已满足** —— `schema/project.schema.json:78` `canvas.width` max **7680**、`:79` `canvas.height` max **4320**、`:240` `track.height` max **200**；且 `validateProjectDoc`（ajv）在 `deserialize` 第 3 步执行 → 超限值**导入即拒绝**，FR-065①② 双达标 | **从待办移除**；同时把 T23「实现要点 3（Schema 补上限）」标注为**已完成** |
| 10 | `listFiles()` 接线 + 文件数上限 2000 + 超限告警 | ⚠️ **条件绑定，不可单独实施** —— FR-012② 本期不要求任何实现，UI 无目录导入入口，`listFiles()` 是 `PlatformBridge` 六方法中唯一零调用方者。PRD §9.2 明确「**将来接线时须同时增加**单层文件数量上限（如 2000）并在超限时显式告警」 | **维持 P1，但标注为「与 FR-012 未来接线绑定」**；现在单独做等于为不存在的调用点写死代码 |
| — | BUG-02 `autoSave.ts` 零测试（FR-005 3s 防抖 + beforeunload） | 仍是测试盲区（QA_REPORT §BUG-02，重要级） | **值得现在做** —— 成本低（定时器 + fake timers），且它正是 FR-063⑦ 的**下游数据安全线**（导入后自动保存出问题 = 用户刚导入的工程丢失，与准则四「用户可能因此损失内容」直接相关） |
| — | BUG-04 导出管线零测试（FR-039~043） | 仍是测试盲区（QA_REPORT §BUG-04，重要级，5 条 P0 FR） | **有条件现在做** —— §9.10 已实测丢帧发生在 `webCodecsExporter.ts:201` + `compositor.ts:46`，是 NEW-BUG-01 的暴露面。建议**只做纯函数层断言**（`exportPlan` 量化 / `compositor` 时间轴判定），WebCodecs 集成层留到 V1.0 后 |
| — | BUG-03 音频引擎零测试（FR-020③④ / FR-034 / FR-035） | 仍是测试盲区（QA_REPORT §BUG-03，重要级） | **暂不做** —— WebAudio 时序测试需音频上下文 mock，成本最高，且无「静默丢失内容」风险，收益/成本比最低 |
| — | BUG-05 `validation.ts` 覆盖率 69.35% → 目标 80% | 实测仍为 69.35% 行 / 52.38% 分支 / 50% 函数（domain 内最低） | **值得现在做** —— 与 FR-063/FR-064 同一导入路径文件族，T23 本就要新增导入路径断言，顺手补覆盖率是**边际成本最低**的一次，且对齐 domain 全局 80% 门槛 |

**排序建议（不改变 FR-063⑦ 的 P0 优先级）**：

```
FR-063⑦ 告警通道（P0，唯一剩余缺口）
  └─→ 同一批次顺带：BUG-05（validation.ts 覆盖 → 80%）· BUG-02（autoSave）
        └─→ 其后：BUG-04（导出管线纯函数层断言）
              └─→ 最后：BUG-03（音频引擎）
```

---

## 九、本裁决**不**改变的事项（明确留痕）

- FR-063①~⑤（重算生效 / 文字 clip 豁免 / 源区间倒置拒绝 / 不报错不阻断 / 派生量与权威字段定义）**全部维持**。
- FR-064 全部维持，**且「两条路径共用同一函数」的契约不得因本裁决而弱化**（判据 6 仍须通过）。
- FR-065 维持「已满足」状态，本轮**不改 Schema**。
- 不引入新的 FR 编号（P0 仍为 49 条 / P1 仍为 12 条 / 合计 66 条）→ **§3.11 统计表无需变动**，`node scripts/check-prd-sync.mjs` 的判据 5 不受影响。
- 不新增门禁判据（本轮采用「类型层面单一入口」，无需判据 7 之类的静态检查兜底）。

---

**—— 裁决结束。实现归工程师，本文件与 `docs/PRD.md` 同步修订后的内容构成完整规格。**
