/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        'cc-bg': {
          app: 'var(--cc-bg-app)',
          panel: 'var(--cc-bg-panel)',
          elevated: 'var(--cc-bg-elevated)',
          track: 'var(--cc-bg-track)',
        },
        'cc-fg': {
          primary: 'var(--cc-fg-primary)',
          secondary: 'var(--cc-fg-secondary)',
          muted: 'var(--cc-fg-muted)',
        },
        'cc-accent': 'var(--cc-accent)',
        'cc-danger': 'var(--cc-danger)',
        'cc-warning': 'var(--cc-warning)',
        'cc-success': 'var(--cc-success)',
        'cc-border': 'var(--cc-border)',
      },
      fontFamily: {
        /**
         * 与 `styles.css` 的 `body` 保持同一套系统字体栈（不加载任何 Web 字体）。
         *
         * 只列各平台**真实预装**的字体；刻意不列 `Noto Sans SC` /
         * `Source Han Sans SC` —— 它们是 Google Fonts 的 Web 字体名，
         * 本机几乎不会预装（Linux 装的是 `Noto Sans CJK SC`）。
         */
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei UI',
          'Microsoft YaHei',
          'Noto Sans CJK SC',
          'WenQuanYi Micro Hei',
          'Heiti SC',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      spacing: {
        toolbar: 'var(--cc-toolbar-height)',
        statusbar: 'var(--cc-statusbar-height)',
        trackhead: 'var(--cc-track-header-width)',
      },
    },
  },
  plugins: [],
};
