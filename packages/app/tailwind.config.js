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
        sans: ['Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
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
