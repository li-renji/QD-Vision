import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 冒烟测试配置。
 *
 * V1.0 只跑 3 条冒烟用例（新建工程 → 导入 → 加文字 → 触发导出流程不崩）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm preview --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
