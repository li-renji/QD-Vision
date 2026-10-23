/**
 * 主布局骨架：**三栏 + 底部时间线**。
 *
 * 纯布局组件，**不渲染任何业务数据**（方便并行开发与测试）。
 */

import type { ReactNode } from 'react';
import { PanelResizer } from './PanelResizer.js';
import { useUiStore } from '../../state/uiStore.js';

/** AppLayout 属性。 */
export interface AppLayoutProps {
  /** 顶部工具栏。 */
  toolbar: ReactNode;
  /** 左侧素材库。 */
  media: ReactNode;
  /** 中央预览。 */
  preview: ReactNode;
  /** 右侧属性面板。 */
  inspector: ReactNode;
  /** 底部时间线。 */
  timeline: ReactNode;
  /** 底部状态条。 */
  statusBar?: ReactNode;
}

/**
 * 主布局。
 */
export function AppLayout({
  toolbar,
  media,
  preview,
  inspector,
  timeline,
  statusBar,
}: AppLayoutProps): JSX.Element {
  const mediaWidth = useUiStore((state) => state.panelWidths.media);
  const inspectorWidth = useUiStore((state) => state.panelWidths.inspector);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--cc-bg-app)]">
      {toolbar}

      <div className="flex min-h-0 flex-1">
        <aside
          className="shrink-0 overflow-hidden border-r border-[var(--cc-border)] bg-[var(--cc-bg-panel)]"
          style={{ width: mediaWidth }}
        >
          {media}
        </aside>

        <PanelResizer target="media" direction="right" />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{preview}</main>

        <PanelResizer target="inspector" direction="left" />

        <aside
          className="shrink-0 overflow-hidden border-l border-[var(--cc-border)] bg-[var(--cc-bg-panel)]"
          style={{ width: inspectorWidth }}
        >
          {inspector}
        </aside>
      </div>

      <section className="h-[38vh] min-h-[220px] shrink-0 overflow-hidden border-t border-[var(--cc-border)] bg-[var(--cc-bg-panel)]">
        {timeline}
      </section>

      {statusBar}
    </div>
  );
}
