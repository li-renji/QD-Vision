// @ts-check
/**
 * ESLint Flat Config —— ClipCut Web
 *
 * 本文件是「架构硬约束」的可执行版本，包含三条分层规则：
 *
 *   规则 A（零直接文件/存储 API）：
 *     业务层禁止 `window.showOpenFilePicker` / `window.showSaveFilePicker` /
 *     `window.showDirectoryPicker` / `localStorage` / `sessionStorage` /
 *     `indexedDB` / `document.cookie`。
 *     白名单：`packages/app/src/platform/**`（平台层）与
 *             `packages/app/src/services/storage/db.ts`（唯一需要直接开库的文件）。
 *
 *   规则 B（零上传）：
 *     `packages/app/src/domain/**` 与 `packages/app/src/services/media/**`
 *     禁止 `fetch` / `XMLHttpRequest` / `navigator.sendBeacon` / `WebSocket`。
 *
 *   规则 C（零厂商 SDK）：
 *     `packages/ai-provider-sdk/**` 禁止 import 任何厂商 AI SDK。
 */
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/** 规则 A 禁止的 window 属性 */
const FORBIDDEN_WINDOW_PROPS = [
  'showOpenFilePicker',
  'showSaveFilePicker',
  'showDirectoryPicker',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'webkitRequestFileSystem',
]

/** 规则 A 禁止的全局变量 */
const FORBIDDEN_STORAGE_GLOBALS = ['localStorage', 'sessionStorage', 'indexedDB']

/** 规则 B 禁止的全局对象（零上传） */
const FORBIDDEN_NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon']

/** 规则 C 禁止的厂商 SDK 模块 */
const FORBIDDEN_VENDOR_IMPORTS = [
  'openai',
  '@anthropic-ai/*',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  '@google/generative-ai/*',
  'google-auth-library',
  'azure',
  'azure/*',
  '@azure/*',
  '@aws-sdk/*',
  'cohere-ai',
  'mistralai',
  'groq-sdk',
  '@cohere-ai/*',
  '@llamaindex/*',
  'langchain',
  'langchain/*',
  '@langchain/*',
]

/** 构造规则 A 的限制项 */
function windowApiRestrictions(props = FORBIDDEN_WINDOW_PROPS) {
  return props.map((property) => ({
    object: 'window',
    property,
    message:
      `禁止在业务层直接访问 window.${property}，请通过 PlatformBridge 抽象（packages/app/src/platform）访问。`,
  }))
}

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/build/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/*.config.js',
      '**/*.config.mjs',
      // Vite 加载 TS 配置时生成的临时编译产物（测试进程被中断时会残留）
      '**/*.timestamp-*.mjs',
    ],
  },

  // ============ Node 脚本（仓库级工具） ============
  {
    // `scripts/**` 是 Node 侧的工具脚本（console / process 是真实存在的全局），
    // 不走 TS 规则块，因此需要显式声明 Node globals，否则 no-undef 会误报。
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // ============ 通用 JS/TS 规则 ============
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
    },
  },

  // ============ 规则 A：零直接文件/存储 API ============
  {
    files: ['packages/app/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...windowApiRestrictions(),
        {
          object: 'document',
          property: 'cookie',
          message: '禁止在业务层访问 document.cookie，请通过 PlatformBridge 抽象访问。',
        },
      ],
      'no-restricted-globals': [
        'error',
        ...FORBIDDEN_STORAGE_GLOBALS.map((name) => ({
          name,
          message: `禁止在业务层直接访问 ${name}，请通过 PlatformBridge 抽象（packages/app/src/platform）访问。`,
        })),
      ],
    },
  },
  // 白名单 1：平台层允许直接访问全部文件/存储 API
  {
    files: ['packages/app/src/platform/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-globals': 'off',
    },
  },
  // 白名单 2：存储层 db.ts 需要直接操作 indexedDB
  {
    files: ['packages/app/src/services/storage/db.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-globals': [
        'error',
        ...FORBIDDEN_STORAGE_GLOBALS.filter((name) => name !== 'indexedDB').map((name) => ({
          name,
          message: `禁止直接访问 ${name}，请使用 PlatformBridge.storage()。`,
        })),
      ],
    },
  },

  // ============ 规则 B：零上传（domain 与 media 禁止网络 API） ============
  {
    files: ['packages/app/src/domain/**/*.{ts,tsx}', 'packages/app/src/services/media/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...FORBIDDEN_NETWORK_GLOBALS.map((name) => ({
          name,
          message:
            `零上传硬约束：${name} 在领域层与媒体服务层被禁止。` +
            `素材字节只能走 Blob → IndexedDB，唯一的出网请求必须集中在 src/services/** 的显式白名单文件中。`,
        })),
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'navigator',
          property: 'sendBeacon',
          message: '零上传硬约束：禁止在领域层与媒体服务层使用 navigator.sendBeacon。',
        },
      ],
    },
  },

  // ============ 规则 C：AI Provider 层零厂商 SDK ============
  {
    files: ['packages/ai-provider-sdk/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: FORBIDDEN_VENDOR_IMPORTS.map((group) => ({
            group: [group],
            message:
              'ai-provider-sdk 必须保持零厂商 SDK 依赖：厂商实现只能出现在 packages/app/src/providers/**，' +
              '并通过统一 AIProvider 接口接入。',
          })),
        },
      ],
    },
  },
)
