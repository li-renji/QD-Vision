import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url)).replace(/\\/g, '/');

export default defineConfig({
  // 缓存写入项目内目录，避免受系统临时目录权限限制
  cacheDir: resolvePath('./node_modules/.vite'),
  test: {
    name: 'shared-types',
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
    },
  },
});
