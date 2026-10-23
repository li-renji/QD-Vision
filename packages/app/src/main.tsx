/**
 * React 挂载入口：初始化 i18n 与主题变量。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { initI18n } from './i18n/index.js';
import { TooltipProvider } from './components/common/Tooltip.js';
import './styles.css';

/** 初始化主题（V1.0 仅暗色单主题，预留 data-theme 钩子）。 */
function initTheme(): void {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.classList.add('dark');
}

initTheme();
initI18n();

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 容器');
}

createRoot(container).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
