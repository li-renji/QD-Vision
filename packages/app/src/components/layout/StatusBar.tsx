/**
 * 底部状态条：能力告警、当前选中、缩放比、吸附开关。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { useUiStore } from '../../state/uiStore.js';
import { useProjectStore } from '../../state/projectStore.js';
import type { PlatformCapabilities } from '../../platform/PlatformBridge.js';
import { getPlatformBridge } from '../../platform/index.js';

/** 底部状态条。 */
export function StatusBar(): JSX.Element {
  const { t } = useTranslation();
  const selectedClipIds = useUiStore((state) => state.selectedClipIds);
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const snapThresholdPx = useUiStore((state) => state.snapThresholdPx);
  const setSnapEnabled = useUiStore((state) => state.setSnapEnabled);
  const dirty = useProjectStore((state) => state.dirty);

  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPlatformBridge()
      .capability()
      .then((result) => {
        if (!cancelled) setCapabilities(result);
      })
      .catch(() => {
        // 能力探测失败不阻塞 UI
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const warning = capabilities
    ? !capabilities.webCodecs
      ? t('export.lowPerformanceMode')
      : !capabilities.fileSystemAccess
        ? t('media.onlineUnavailable')
        : null
    : null;

  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-4 border-t border-[var(--cc-border)] bg-[var(--cc-bg-panel)] px-3 text-[11px] text-[var(--cc-fg-muted)]">
      {warning ? <span className="text-[var(--cc-warning)]">{warning}</span> : null}

      <span>
        {selectedClipIds.length > 0
          ? t('status.selection', { count: selectedClipIds.length })
          : t('status.noSelection')}
      </span>

      <span>{t('status.zoom', { value: `${Math.round(pxPerSecond)}px/s` })}</span>

      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={snapEnabled}
          onChange={(event) => setSnapEnabled(event.target.checked)}
          className="h-3 w-3 accent-[var(--cc-accent)]"
        />
        {t('status.snap')}
      </label>

      <span>{t('status.snapThreshold', { value: snapThresholdPx })}</span>

      <span className="ml-auto">{dirty ? t('toolbar.unsaved') : t('toolbar.saved')}</span>
    </footer>
  );
}
