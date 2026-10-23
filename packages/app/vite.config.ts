import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 把相对路径解析为基于本文件目录的绝对路径（POSIX 分隔符）。 */
const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url)).replace(/\\/g, '/');

/**
 * e2e 专用构建输出目录。
 *
 * ## 为什么需要独立目录
 *
 * `vite build` 会**先清空 `outDir` 再重写**。若 e2e 的 `vite preview` 与开发时的
 * `pnpm build` 共用同一个 `dist/`，那么只要有人（人或并行 CI 任务）在另一处重建，
 * 正在跑的 e2e 就会读到**半截**的 `index.html`（标题变空字符串）或资源 404，
 * 表现为**随机失败、且每次失败的用例都不同**。
 *
 * 因此 e2e 走`E2E=1 vite build --outDir dist-e2e` 产出的独立目录，
 * 与开发用的 `dist/` 彻底隔离，互不干扰。
 */
const E2E_OUT_DIR = 'dist-e2e';
const isE2EBuild = process.env['E2E'] === '1';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolvePath('./src'),
      '@clipcut/shared-types': resolvePath('../shared-types/src/index.ts'),
      '@clipcut/ai-provider-sdk': resolvePath('../ai-provider-sdk/src/index.ts'),
    },
  },
  build: {
    outDir: isE2EBuild ? E2E_OUT_DIR : 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // 手动 chunk 拆分：vendor（框架）与 editor（剪辑内核）
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand', 'immer'],
          editor: ['mp4-muxer', 'mp4box', 'ajv', 'idb'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
  },
});
