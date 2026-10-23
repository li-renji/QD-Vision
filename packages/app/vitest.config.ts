import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url)).replace(/\\/g, '/');

/**
 * 把进程临时目录指向项目内目录。
 *
 * ## 为什么需要
 *
 * Vitest 2 写模块缓存会落到 `<os.tmpdir()>/<random>/web/<hash>`。在受限文件系统
 * 环境（沙箱 / 容器 / 权限受限的 CI runner）下该写入被拒（EPERM），导致 worker
 * 崩溃、**随机**丢失一整个测试文件，退出码变成 1 —— 极易被误判成代码问题。
 *
 * ## 为什么带写探针
 *
 * 直接改写 TEMP 有风险：若目标目录不可写，Vitest 会把 TEMP 指向一个**不可用**位置，
 * 比原来的 EPERM 更难排查（表现为挂起而非报错）。因此这里先做一次真实的
 * 写入-删除探针，**确认可写后**才改写环境变量；任何一步失败都保持系统默认行为。
 *
 * ## 副作用控制
 *
 * 只影响本 Node 进程及其子进程，不修改系统环境变量；目录位于
 * `node_modules/.vite/tmp`（已在 .gitignore 中），随 `pnpm install` 自动清理。
 */
function redirectTempDir(): void {
  try {
    const dir = resolvePath('./node_modules/.vite/tmp');
    mkdirSync(dir, { recursive: true });

    // 写探针：确认目标目录真的可写
    const probe = path.join(dir, '.write-probe');
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });

    process.env['TEMP'] = dir;
    process.env['TMP'] = dir;
    process.env['TMPDIR'] = dir;
  } catch {
    // 保持系统默认行为
  }
}

redirectTempDir();

export default defineConfig({
  // 显式指定项目内缓存目录，避免写入系统临时目录（部分沙箱环境无写权限）
  cacheDir: resolvePath('./node_modules/.vite'),
  resolve: {
    alias: {
      '@': resolvePath('./src'),
      '@clipcut/shared-types': resolvePath('../shared-types/src/index.ts'),
      '@clipcut/ai-provider-sdk': resolvePath('../ai-provider-sdk/src/index.ts'),
    },
  },
  test: {
    name: 'app',
    environment: 'happy-dom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/__tests__/**', 'src/domain/**/index.ts'],
      thresholds: {
        // 验收要求：domain 层**行覆盖** ≥ 80%
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 60,
      },
    },
  },
});
