/**
 * 预览面板容器：画布 + 传输控制 + 画布设置栏。
 */

import { useState } from 'react';
import { CanvasSettingsBar } from './CanvasSettingsBar.js';
import { PreviewCanvas } from './PreviewCanvas.js';
import { PreviewControls } from './PreviewControls.js';

/**
 * 预览面板。
 */
export function PreviewPanel(): JSX.Element {
  const [zoomMode, setZoomMode] = useState<'fit' | 'fill' | 'original'>('fit');

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--cc-bg-app)]">
      <CanvasSettingsBar zoomMode={zoomMode} onZoomModeChange={setZoomMode} />
      <PreviewCanvas zoomMode={zoomMode} />
      <PreviewControls />
    </div>
  );
}
