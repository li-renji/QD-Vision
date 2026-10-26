/**
 * 滤镜分区：预设 + 强度。
 *
 * 滤镜走 Canvas 2D `ctx.filter`（`render/filters.ts`），预览与导出共用
 * 同一份映射，做到「所见即所得」。数据落在 `clip.filter`，随工程序列化。
 */

import type { FilterPresetId } from '@clipcut/shared-types';
import { useTranslation } from '../../i18n/index.js';
import { usePrimarySelectedClip } from '../../state/selectors.js';
import { setClipPropertyForSelected } from '../../state/actions.js';
import { FILTER_PRESET_IDS } from '../../render/filters.js';
import { Slider } from '../common/Slider.js';
import { clsx } from '../../utils/clsx.js';

/** 预设 → i18n key。 */
const PRESET_LABEL_KEYS: Record<FilterPresetId, string> = {
  none: 'inspector.filter.none',
  vivid: 'inspector.filter.vivid',
  mono: 'inspector.filter.mono',
  vintage: 'inspector.filter.vintage',
  cool: 'inspector.filter.cool',
  warm: 'inspector.filter.warm',
  fade: 'inspector.filter.fade',
  sharp: 'inspector.filter.sharp',
};

/** 全部预设（含「无」）。 */
const ALL_PRESETS: FilterPresetId[] = ['none', ...FILTER_PRESET_IDS];

/**
 * 滤镜分区。
 */
export function FilterSection(): JSX.Element | null {
  const { t } = useTranslation();
  const clip = usePrimarySelectedClip();

  if (!clip) return null;

  const preset: FilterPresetId = clip.filter?.preset ?? 'none';
  const intensity = clip.filter?.intensity ?? 1;

  const applyPreset = (next: FilterPresetId): void => {
    setClipPropertyForSelected('filter', { preset: next, intensity });
  };

  return (
    <section className="border-b border-[var(--cc-border)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
        {t('inspector.filter')}
      </h3>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {ALL_PRESETS.map((id) => (
            <button
              key={id}
              type="button"
              className={clsx(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                preset === id
                  ? 'border-[var(--cc-accent)] bg-[var(--cc-accent)] text-white'
                  : 'border-[var(--cc-border)] text-[var(--cc-fg-secondary)] hover:bg-[var(--cc-bg-elevated)]',
              )}
              onClick={() => applyPreset(id)}
            >
              {t(PRESET_LABEL_KEYS[id])}
            </button>
          ))}
        </div>

        {preset !== 'none' ? (
          <label className="flex flex-col gap-1">
            <span className="cc-label">
              {t('inspector.filterIntensity')} · {Math.round(intensity * 100)}%
            </span>
            <Slider
              value={intensity}
              min={0}
              max={1}
              step={0.01}
              ariaLabel={t('inspector.filterIntensity')}
              onValueChange={(value) => setClipPropertyForSelected('filter.intensity', value)}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}
