import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineWorkspace } from 'vitest/config'

const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url)).replace(/\\/g, '/')

/** 源码别名（与 packages/app/vite.config.ts 保持一致） */
const alias = {
  '@': resolvePath('./packages/app/src'),
  '@clipcut/shared-types': resolvePath('./packages/shared-types/src/index.ts'),
  '@clipcut/ai-provider-sdk': resolvePath('./packages/ai-provider-sdk/src/index.ts'),
}

/**
 * 把进程临时目录指向项目内目录。
 *
 * Vitest 2 写模块缓存会落到 `<os.tmpdir()>/<random>/web/<hash>`；在受限文件系统
 * 环境下该写入被拒（EPERM）→ worker 崩溃 → **随机**丢失一整个测试文件 + 退出码 1。
 *
 * 带**写探针**：只有确认目标目录真的可写后才改写 TEMP/TMP/TMPDIR，
 * 避免把 TEMP 指向不可用位置造成挂起（比 EPERM 更难排查）。
 */
function redirectTempDir(): void {
  try {
    const dir = resolvePath('./node_modules/.vite/tmp')
    mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.write-probe')
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    process.env['TEMP'] = dir
    process.env['TMP'] = dir
    process.env['TMPDIR'] = dir
  } catch {
    // 保持系统默认行为
  }
}

redirectTempDir()

/**
 * Vitest workspace：定义 `app`（happy-dom）与 `shared-types`（node）两个测试工程。
 *
 * ⚠️ **CI 与 `pnpm test` 走按包分别执行**（见根 `package.json` 的 `test` 脚本），
 * 因为 workspace 模式在受限文件系统环境下偶发 Vite 模块缓存写入失败。
 * 本文件通过 `pnpm test:workspace` 供本地一次性跑全部工程。
 * （各 package 自己的 vitest.config.ts 才是 CI 真正使用的配置。）
 *
 * 关于 coverage 阈值：
 * `coverage` 是 **workspace 根级** 选项，**不能**写在单个 project 的 `test` 里
 * （写在 project 内会被 TS 判为 `ProjectConfig` 的未知属性 —— 这正是此前
 * 「阈值静默失效 + 类型检查漏过」的根因）。因此本文件不声明 coverage；
 * 真正生效的阈值位于 `packages/app/vitest.config.ts`，由 `pnpm test:coverage` 使用。
 *
 * 本文件已纳入 `tsconfig.configs.json` 的类型检查范围（`pnpm typecheck`）。
 */
export default defineWorkspace([
  {
    test: {
      name: 'app',
      root: './packages/app',
      environment: 'happy-dom',
      globals: false,
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
    },
    resolve: { alias },
  },
  {
    test: {
      name: 'shared-types',
      root: './packages/shared-types',
      environment: 'node',
      globals: false,
      include: ['src/**/*.test.ts'],
    },
    resolve: { alias },
  },
])