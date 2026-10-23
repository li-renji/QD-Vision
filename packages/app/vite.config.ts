import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 把相对路径解析为基于本文件目录的绝对路径（POSIX 分隔符）。 */
const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url)).replace(/\\/g, '/');

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
    outDir: 'dist',
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
