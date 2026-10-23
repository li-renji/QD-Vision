import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 冒烟 + 播放链路测试配置。
 *
 * ## 独立构建目录与端口（关键）
 *
 * webServer 先把应用构建到 **`dist-e2e/`**、再 preview 该目录，
 * **刻意不复用开发用的 `dist/` 与 4173 端口**。
 *
 * 原因：`vite build` 会先清空 `outDir` 再重写。若与开发时的 `pnpm build`
 * 共用 `dist/`，那么本地一边 build、一边跑 e2e 时，正在跑的用例会读到
 * **半截**的 `index.html`（标题变空字符串）或资源 404，表现为**随机失败、
 * 每次失败的用例都不同**的 flaky。独立目录 + 独立端口后彻底互不影响。
 *
 * - `--outDir dist-e2e`：Vite 的 CLI 参数优先级高于 `vite.config.ts`，无需环境变量
 * - `reuseExistingServer: false`：强制用本次构建产物，杜绝复用旧服务
 */
const E2E_PORT = 4183;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `vite build --outDir dist-e2e && vite preview --outDir dist-e2e --port ${E2E_PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});