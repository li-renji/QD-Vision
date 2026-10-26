/**
 * 属性面板容器：随选中对象动态切换分区，无选中时显示导出设置。
 */

import { useTranslation } from '../../i18n/index.js';
import { usePrimarySelectedClip } from '../../state/selectors.js';
import { TransformSection } from './TransformSection.js';
import { FilterSection } from './FilterSection.js';
import { AudioSection } from './AudioSection.js';
import { TextSection } from './TextSection.js';
import { SubtitleSection } from './SubtitleSection.js';
import { AssetSection } from './AssetSection.js';
import { ExportSection } from './ExportSection.js';

/** InspectorPanel 属性。 */
export interface InspectorPanelProps {
  /** 请求重新定位素材。 */
  onRelink?: (assetId: string) => void;
}

/**
 * 属性面板。
 */
export function InspectorPanel({ onRelink }: InspectorPanelProps): JSX.Element {
  const { t } = useTranslation();
  const clip = usePrimarySelectedClip();

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b border-[var(--cc-border)] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
          {t('inspector.title')}
        </h2>
      </div>

      {clip ? (
        <>
          <TransformSection />
          <FilterSection />
          <AudioSection />
          {clip.text ? <TextSection /> : null}
          {clip.assetId ? <AssetSection {...(onRelink ? { onRelink } : {})} /> : null}
          <SubtitleSection />
        </>
      ) : (
        <p className="px-3 py-2 text-[11px] text-[var(--cc-fg-muted)]">
          {t('inspector.noSelection')}
        </p>
      )}

      {/* 导出设置**始终可见**：选中轨道 / 片段时也不能挡住导出入口。 */}
      <ExportSection />
    </div>
  );
}
