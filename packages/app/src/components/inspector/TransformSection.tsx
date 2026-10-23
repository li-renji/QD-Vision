/**
 * 变换分区：位置 / 缩放 / 旋转 / 不透明度 / 圆角 / 适配模式。
 *
 * **PIP 与文字共用同一套 transform 组件**（FR-030）。
 */

import { useTranslation } from '../../i18n/index.js';
import { usePrimarySelectedClip } from '../../state/selectors.js';
import { setClipProperty } from '../../state/actions.js';
import { NumberField } from '../common/NumberField.js';
import { Slider } from '../common/Slider.js';
import { Select } from '../common/Select.js';
import type { FitMode } from '@clipcut/shared-types';

/**
 * 变换分区。
 */
export function TransformSection(): JSX.Element | null {
  const { t } = useTranslation();
  const clip = usePrimarySelectedClip();

  if (!clip) return null;

  const set = (path: string, value: unknown): void => {
    setClipProperty(clip.id, path, value);
  };

  return (
    <section className="border-b border-[var(--cc-border)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
        {t('inspector.transform')}
      </h3>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <NumberField
            label={t('inspector.positionX')}
            value={clip.transform.x}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(value) => set('transform.x', value)}
            className="flex-1"
          />
          <NumberField
            label={t('inspector.positionY')}
            value={clip.transform.y}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(value) => set('transform.y', value)}
            className="flex-1"
          />
        </div>

        <NumberField
          label={t('inspector.scale')}
          value={clip.transform.scale}
          min={0.01}
          max={20}
          step={0.01}
          onValueChange={(value) => set('transform.scale', value)}
        />

        <NumberField
          label={t('inspector.rotation')}
          value={clip.transform.rotation}
          min={-3600}
          max={3600}
          step={1}
          unit="°"
          onValueChange={(value) => set('transform.rotation', value)}
        />

        <label className="flex flex-col gap-1">
          <span className="cc-label">{t('inspector.opacity')}</span>
          <Slider
            value={clip.transform.opacity}
            min={0}
            max={1}
            step={0.01}
            ariaLabel={t('inspector.opacity')}
            onValueChange={(value) => set('transform.opacity', value)}
          />
        </label>

        <NumberField
          label={t('inspector.cornerRadius')}
          value={clip.transform.cornerRadius}
          min={0}
          max={1000}
          step={1}
          unit="px"
          onValueChange={(value) => set('transform.cornerRadius', value)}
        />

        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('inspector.fit')}</span>
          <Select
            value={clip.transform.fit}
            onValueChange={(value) => set('transform.fit', value as FitMode)}
            options={[
              { value: 'contain', label: t('inspector.fit.contain') },
              { value: 'cover', label: t('inspector.fit.cover') },
              { value: 'fill', label: t('inspector.fit.fill') },
            ]}
            ariaLabel={t('inspector.fit')}
          />
        </div>
      </div>
    </section>
  );
}
