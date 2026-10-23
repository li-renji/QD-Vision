/**
 * 文字分区：内容 + 全套样式 + 3 组预设。
 */

import { useTranslation } from '../../i18n/index.js';
import { usePrimarySelectedClip } from '../../state/selectors.js';
import { setClipProperty, setTextProps } from '../../state/actions.js';
import { TextField } from '../common/TextField.js';
import { Checkbox } from '../common/Checkbox.js';
import { NumberField } from '../common/NumberField.js';
import { Select } from '../common/Select.js';
import { Button } from '../common/Button.js';
import type { ClipTextProps, TextAlign, VerticalAlign } from '@clipcut/shared-types';

/** 文字预设样式。 */
const TEXT_PRESETS: Array<{ key: string; labelKey: string; props: Partial<ClipTextProps> }> = [
  {
    key: 'white-black',
    labelKey: 'inspector.textPreset1',
    props: {
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 4,
      backgroundColor: null,
    },
  },
  {
    key: 'yellow-black',
    labelKey: 'inspector.textPreset2',
    props: {
      color: '#FFD400',
      strokeColor: '#000000',
      strokeWidth: 4,
      backgroundColor: null,
    },
  },
  {
    key: 'white-translucent',
    labelKey: 'inspector.textPreset3',
    props: {
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
  },
];

/**
 * 文字分区。
 */
export function TextSection(): JSX.Element | null {
  const { t } = useTranslation();
  const clip = usePrimarySelectedClip();

  if (!clip || !clip.text) return null;

  const text = clip.text;

  return (
    <section className="border-b border-[var(--cc-border)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
        {t('inspector.text')}
      </h3>

      <div className="flex flex-col gap-2">
        <TextField
          label={t('inspector.textContent')}
          value={text.content}
          multiline
          rows={4}
          onValueChange={(value) => setTextProps(clip.id, { content: value })}
        />

        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('inspector.textPreset')}</span>
          <div className="flex gap-1">
            {TEXT_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                size="sm"
                variant="subtle"
                onClick={() => setTextProps(clip.id, preset.props)}
              >
                {t(preset.labelKey)}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('inspector.textFont')}</span>
          <input
            type="text"
            value={text.fontFamily}
            onChange={(event) => setTextProps(clip.id, { fontFamily: event.target.value })}
            className="cc-input flex-1"
          />
        </div>

        <div className="flex items-center gap-2">
          <NumberField
            label={t('inspector.textSize')}
            value={text.fontSize}
            min={1}
            max={2000}
            step={1}
            onValueChange={(value) => setTextProps(clip.id, { fontSize: value })}
            className="flex-1"
          />
          <NumberField
            label={t('inspector.textWeight')}
            value={text.fontWeight}
            min={100}
            max={900}
            step={100}
            onValueChange={(value) => setTextProps(clip.id, { fontWeight: value })}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('inspector.textStyle')}</span>
          <Select
            value={text.fontStyle}
            onValueChange={(value) => setTextProps(clip.id, { fontStyle: value as 'normal' | 'italic' })}
            options={[
              { value: 'normal', label: 'normal' },
              { value: 'italic', label: 'italic' },
            ]}
            ariaLabel={t('inspector.textStyle')}
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-1">
            <span className="cc-label">{t('inspector.textColor')}</span>
            <input
              type="color"
              value={text.color}
              onChange={(event) => setTextProps(clip.id, { color: event.target.value })}
              className="h-6 w-10 cursor-pointer rounded border border-[var(--cc-border)] bg-transparent"
            />
          </label>
          <label className="flex flex-1 items-center gap-1">
            <span className="cc-label">{t('inspector.textStrokeColor')}</span>
            <input
              type="color"
              value={text.strokeColor}
              onChange={(event) => setTextProps(clip.id, { strokeColor: event.target.value })}
              className="h-6 w-10 cursor-pointer rounded border border-[var(--cc-border)] bg-transparent"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <NumberField
            label={t('inspector.textStrokeWidth')}
            value={text.strokeWidth}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => setTextProps(clip.id, { strokeWidth: value })}
            className="flex-1"
          />
          <label className="flex flex-1 items-center gap-1">
            <span className="cc-label">{t('inspector.textBackground')}</span>
            <input
              type="color"
              value={text.backgroundColor ?? '#000000'}
              onChange={(event) => setTextProps(clip.id, { backgroundColor: event.target.value })}
              className="h-6 w-10 cursor-pointer rounded border border-[var(--cc-border)] bg-transparent"
            />
            <Checkbox
              checked={text.backgroundColor !== null}
              onCheckedChange={(checked) =>
                setTextProps(clip.id, { backgroundColor: checked ? 'rgba(0,0,0,0.5)' : null })
              }
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <NumberField
            label={t('inspector.textLineHeight')}
            value={text.lineHeight}
            min={0.1}
            max={10}
            step={0.1}
            onValueChange={(value) => setTextProps(clip.id, { lineHeight: value })}
            className="flex-1"
          />
          <NumberField
            label={t('inspector.textLetterSpacing')}
            value={text.letterSpacing}
            min={-100}
            max={100}
            step={1}
            onValueChange={(value) => setTextProps(clip.id, { letterSpacing: value })}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('inspector.textAlign')}</span>
          <Select
            value={text.align}
            onValueChange={(value) => setTextProps(clip.id, { align: value as TextAlign })}
            options={[
              { value: 'left', label: '←' },
              { value: 'center', label: '↔' },
              { value: 'right', label: '→' },
            ]}
            ariaLabel={t('inspector.textAlign')}
          />
          <Select
            value={text.verticalAlign}
            onValueChange={(value) => setTextProps(clip.id, { verticalAlign: value as VerticalAlign })}
            options={[
              { value: 'top', label: '↑' },
              { value: 'middle', label: '↕' },
              { value: 'bottom', label: '↓' },
            ]}
            ariaLabel={t('inspector.textVerticalAlign')}
          />
        </div>
      </div>
    </section>
  );
}

/** 供其它模块复用的文字属性写入。 */
export { setClipProperty };
