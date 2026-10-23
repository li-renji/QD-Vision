# QD视界

> **纯浏览器视频剪辑器** · 零安装 · 素材不出本地 · AI 能力可插拔
> 版本：`1.0.0` · 许可证：[MIT](./LICENSE)

一个完全运行在浏览器里的开源视频剪辑器：打开网页就能剪片，**素材一个字节都不会离开你的设备**。

```
┌─ 素材库 ─┬─ 预览画布 ─┬─ 属性面板 ─┐
│          │              │           │
├──────────┴──────────────┴───────────┤
│              时间线                   │
└───────────────────────────────────────┘
```

## 特性

| 能力 | 说明 |
| --- | --- |
| **零安装** | 纯静态站点，`pnpm build` 产物可部署到任意静态服务器 |
| **零上传** | 素材只走 `Blob → IndexedDB`；Network 面板 0 次素材上行 |
| **多轨剪辑** | 2 视频 + 2 音频 + 1 文字轨起步，可增删；分割 / 裁剪 / 变速 / 复制 / 多选 |
| **画中画** | 最多 4 层 PIP，独立变换（位置 / 缩放 / 旋转 / 不透明度 / 圆角） |
| **文字与字幕** | Canvas 文字样式全套 + 3 组预设；SRT 导入 / 导出，往返一致率 100% |
| **导出** | 主路径 WebCodecs + mp4-muxer（离帧逐帧），兜底 MediaRecorder（WebM） |
| **AI 可插拔** | 统一 `AIProvider` 接口 + 路由 + fallback，**零厂商 SDK 依赖** |
| **MCP 接入** | 独立 MCP Server 骨架（stdio + WebSocket 本地通道），15 个工具 |

## 快速开始

```bash
# 1. 安装依赖（需要 Node.js ≥ 20 与 pnpm ≥ 9）
corepack enable pnpm
pnpm install

# 2. 本地开发
pnpm dev          # → http://127.0.0.1:5173

# 3. 质量门禁
pnpm lint         # ESLint（含三条分层硬规则）
pnpm typecheck    # tsc --noEmit（strict + exactOptionalPropertyTypes）
pnpm test         # Vitest（344 个用例 / 32 个测试文件）+ 测试守门器
pnpm build        # 四个包依次构建，产物为纯静态资源

# 4. 预览生产产物
pnpm preview      # → http://127.0.0.1:4173

# 5. 端到端冒烟 + 品牌/排版回归（需要一次性安装浏览器）
pnpm exec playwright install chromium
pnpm --filter @clipcut/app exec playwright test
#   e2e/smoke.spec.ts    —— 启动 / 新建工程 / 导出面板
#   e2e/branding.spec.ts —— 品牌名、字体栈、轨道头对齐与轨道名可读宽度
```

其它脚本：

```bash
pnpm test:coverage      # 覆盖率（domain 层行覆盖 ≥ 80%）
pnpm test:workspace     # 两个包合并跑（等价于 vitest --workspace .）
pnpm schema:check       # JSON Schema 夹具校验
pnpm check:prd-sync     # PRD ↔ TASKS 同步守门
pnpm check              # lint + typecheck + test + build + schema:check + check:prd-sync
```

### 测试守门器

`pnpm test` 在两个包的 Vitest 跑完之后，会执行 `scripts/verify-test-count.mjs`：
比对「磁盘上应该存在的测试文件**集合**」与「本次实际执行的测试文件**集合**」。

**为什么需要**：在受限文件系统环境（某些沙箱 / 容器）下，Vitest 写模块缓存到
系统临时目录会被拒绝（EPERM），导致 worker 崩溃、**随机**丢失一整个测试文件 ——
此时用例全绿、看起来是「通过」，实际却漏跑了测试。守门器把这种**静默降级变成硬失败**。

> 若在本地看到 `[verify-test-count] ❌ ... 有文件被静默丢弃`，
> 说明**本次结果不可信**（漏跑了测试），请在正常环境重跑，而不是当作「测试通过」。

**为什么比「集合」而不是「数量」**：两个数据来源（磁盘 glob 与 Vitest JSON 报告）
同时出问题时，只比数量必然漏检 —— 比如「报告与磁盘恰好同时少了同一个文件」，
数量相等但内容已错。只有比对**文件名集合**才能捕获。
守门器现已改为双向差集比对，并会**点名**具体是哪个文件漏跑 / 多跑。

## 目录结构

```
qd-shijie/
├─ packages/
│  ├─ app/               # 主应用（Vite + React 18 + TS 5）
│  │  ├─ src/platform/   # PlatformBridge 抽象层（唯一允许碰 window.* 文件 API 的地方）
│  │  ├─ src/domain/     # 纯领域层：零 DOM / 零 fetch / 零 IndexedDB
│  │  ├─ src/state/      # Zustand 状态层 + Immer patch 撤销栈
│  │  ├─ src/services/   # 浏览器能力层（存储 / 媒体 / 导出）
│  │  ├─ src/render/     # Canvas 2D 合成引擎（预览与导出共用）
│  │  ├─ src/components/ # 表现层
│  │  └─ src/i18n/       # 自研轻量 i18n（zh-CN / en-US）
│  ├─ shared-types/      # 跨包类型与协议（零运行时依赖）
│  ├─ ai-provider-sdk/   # AI Provider 抽象与路由（零厂商 SDK）
│  └─ mcp-server/        # MCP Server 骨架（stdio + WebSocket 通道）
├─ schema/               # 工程 JSON Schema（唯一真源）
├─ fixtures/             # 3 个工程夹具（往返一致性测试）
└─ docs/                 # 架构 / 任务 / 协议文档
```

## 三条架构硬约束

这些约束由 **ESLint 分层规则**在 CI 中强制执行，不是口头约定：

| 约束 | 落地方式 | 检查方式 |
| --- | --- | --- |
| **业务层零直接调用 `window.*` 文件/存储 API** | 一切经 `PlatformBridge` | ESLint `no-restricted-properties`，白名单仅 `src/platform/**` 与 `src/services/storage/db.ts` |
| **零上传** | 素材字节只走 `Blob → IndexedDB` | ESLint 禁止 `fetch` / `XHR` / `sendBeacon` / `WebSocket` 出现在 `src/domain/**` 与 `src/services/media/**` |
| **AI 层零厂商 SDK** | 厂商实现只在 `src/providers/**` | ESLint `no-restricted-imports` + CI 断言 `ai-provider-sdk` 依赖树 |

## 核心不变式

```ts
// 唯一允许写 clip 时间字段的地方：src/domain/timeline/operations.ts
durationMs === Math.round((outMs - inMs) / speed)
```

`meta.durationMs` 是**派生量**，加载后立即重算覆盖，不作为数据源。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/HANDOVER.md`](./docs/HANDOVER.md) | **续开工入口**：当前状态、剩余事项、环境坑 |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | 系统架构设计（分层、时序、选型） |
| [`docs/TASKS.md`](./docs/TASKS.md) | 任务分解（T1 ~ T23） |
| [`docs/PRD.md`](./docs/PRD.md) | 产品需求（FR-001 ~ FR-066，P0 49 条） |
| [`docs/QA_REPORT.md`](./docs/QA_REPORT.md) | QA 七轮验证全过程（含勘误留痕） |
| [`docs/ai/provider-api.md`](./docs/ai/provider-api.md) | 如何实现一个新的 AI Provider |
| [`docs/mcp/channel-protocol.md`](./docs/mcp/channel-protocol.md) | MCP ↔ 剪辑内核通道协议 |

## 浏览器兼容

| 浏览器 | 能力 |
| --- | --- |
| Chrome / Edge 111+ | 全功能（WebCodecs 硬编码 + MP4 导出） |
| Safari 16.4+ | 部分降级（AAC 编码受限，可能降级 Opus/WebM） |
| Firefox | WebCodecs 支持有限，建议使用 MediaRecorder 兜底导出模式 |

## 贡献

1. Fork → 新建分支（`feat/xxx`）
2. `pnpm check` 全绿
3. 提交 PR，描述对应的 FR 编号

任何改动都**不得**破坏上述三条硬约束；CI 会拦截。

## 许可

[MIT](./LICENSE)
