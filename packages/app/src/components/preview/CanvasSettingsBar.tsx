/**
 * 画布设置栏：比例预设（16:9 / 9:16 / 1:1 / 4:5 / 原始）与缩放模式。
 */

import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { resizeCanvas } from '../../state/actions.js';
import { Select } from '../common/Select.js';
import { IconButton } from '../common/IconButton.js';
import { Icon } from '../common/Icon.js';
import type { AspectPreset } from '@clipcut/shared-types';

/** 比例预设。 */
const ASPECTS: { value: AspectPreset; width: number; height: number }[] = [
  { value: '16:9', width: 1920, height: 1080 },
  { value: '9:16', width: 1080, height: 1920 },
  { value: '1:1', width: 1080, height: 1080 },
  { value: '4:5', width: 1080, height: 1350 },
];

/** CanvasSettingsBar 属性。 */
export interface CanvasSettingsBarProps {
  zoomMode: 'fit' | 'fill' | 'original';
  onZoomModeChange: (mode: 'fit' | 'fill' | 'original') => void;
}

/**
 * 画布设置栏。
 */
export function CanvasSettingsBar({
  zoomMode,
  onZoomModeChange,
}: CanvasSettingsBarProps): JSX.Element {
  const { t } = useTranslation();
  const canvas = useProjectStore((state) => state.doc.settings.canvas);

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--cc-border)] bg-[var(--cc-bg-panel)] px-3">
      <span className="cc-label">{t('preview.aspect')}</span>
      <Select
        value={canvas.aspectPreset}
        onValueChange={(value) => {
          const preset = ASPECTS.find((item) => item.value === value);
          if (!preset) return;
          resizeCanvas(preset.width, preset.height);
        }}
        options={ASPECTS.map((item) => ({ value: item.value, label: item.value }))}
        ariaLabel={t('preview.aspect')}
      />

      <span className="cc-label">{t('preview.zoomFit')}</span>
      <Select
        value={zoomMode}
        onValueChange={(value) => onZoomModeChange(value as 'fit' | 'fill' | 'original')}
        options={[
          { value: 'fit', label: t('preview.zoomFit') },
          { value: 'fill', label: t('preview.zoomFill') },
          { value: 'original', label: t('preview.zoomOriginal') },
        ]}
        ariaLabel={t('preview.zoomFit')}
      />

      <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-[var(--cc-fg-muted)]">
        {canvas.width}×{canvas.height} @ {canvas.fps}fps
      </span>

      <IconButton
        label={t('preview.fullscreen')}
        onClick={() => {
          const element = document.documentElement;
          if (document.fullscreenElement) {
            void document.exitFullscreen();
          } else {
            void element.requestFullscreen?.();
          }
        }}
        icon={<Icon name="film" size={14} />}
      />
    </div>
  );
}
