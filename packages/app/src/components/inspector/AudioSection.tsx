/**
 * 音频分区：音量、淡入淡出、静音、变速。
 */

import { useTranslation } from '../../i18n/index.js';
import { usePrimarySelectedClip } from '../../state/selectors.js';
import { setClipPropertyForSelected, setClipSpeed } from '../../state/actions.js';
import { NumberField } from '../common/NumberField.js';
import { Slider } from '../common/Slider.js';
import { Select } from '../common/Select.js';
import { Checkbox } from '../common/Checkbox.js';

/** 常用变速档位。 */
const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4];

/**
 * 音频分区。
 */
export function AudioSection(): JSX.Element | null {
  const { t } = useTranslation();
  const clip = usePrimarySelectedClip();

  if (!clip) return null;

  return (
    <section className="border-b border-[var(--cc-border)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
        {t('inspector.audio')}
      </h3>

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="cc-label">
            {t('inspector.gain')} · {clip.audio.gain.toFixed(2)}
          </span>
          <Slider
            value={clip.audio.gain}
            min={0}
            max={2}
            step={0.01}
            ariaLabel={t('inspector.gain')}
            onValueChange={(value) => setClipPropertyForSelected('audio.gain', value)}
          />
        </label>

        <div className="flex items-center gap-2">
          <NumberField
            label={t('inspector.fadeIn')}
            value={clip.audio.fadeInMs}
            min={0}
            step={100}
            unit="ms"
            onValueChange={(value) => setClipPropertyForSelected('audio.fadeInMs', value)}
            className="flex-1"
          />
          <NumberField
            label={t('inspector.fadeOut')}
            value={clip.audio.fadeOutMs}
            min={0}
            step={100}
            unit="ms"
            onValueChange={(value) => setClipPropertyForSelected('audio.fadeOutMs', value)}
            className="flex-1"
          />
        </div>

        <Checkbox
          checked={clip.audio.muted}
          label={t('inspector.mute')}
          onCheckedChange={(checked) => setClipPropertyForSelected('audio.muted', checked)}
        />

        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('inspector.speed')}</span>
          <Select
            value={String(clip.speed)}
            onValueChange={(value) => {
              const speed = Number(value);
              if (Number.isFinite(speed)) setClipSpeed(clip.id, speed);
            }}
            options={SPEED_PRESETS.map((speed) => ({ value: String(speed), label: `${speed}x` }))}
            ariaLabel={t('inspector.speed')}
          />
          <NumberField
            label={t('inspector.speedCustom')}
            value={clip.speed}
            min={0.1}
            max={10}
            step={0.1}
            onValueChange={(value) => setClipSpeed(clip.id, value)}
            className="flex-1"
          />
        </div>
      </div>
    </section>
  );
}
