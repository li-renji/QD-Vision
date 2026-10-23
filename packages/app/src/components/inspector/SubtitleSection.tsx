/**
 * 字幕分区：字幕轨开关、整体样式、烧录开关、导出 SRT、cue 列表编辑。
 */

import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import {
  addSubtitleCue,
  removeSubtitleCue,
  setExportSettings,
  setSubtitleSettings,
  updateSubtitleCue,
} from '../../state/actions.js';
import { stringifySrt } from '../../domain/subtitles/srt.js';
import { Checkbox } from '../common/Checkbox.js';
import { NumberField } from '../common/NumberField.js';
import { Select } from '../common/Select.js';
import { Button } from '../common/Button.js';
import { TextField } from '../common/TextField.js';
import { downloadBlob } from '../../services/export/download.js';
import { formatDuration } from '@clipcut/shared-types';
import type { TextAlign } from '@clipcut/shared-types';

/**
 * 字幕分区。
 */
export function SubtitleSection(): JSX.Element {
  const { t } = useTranslation();
  const subtitles = useProjectStore((state) => state.doc.subtitles);
  const burnIn = useProjectStore((state) => state.doc.settings.export.burnInSubtitle);

  return (
    <section className="border-b border-[var(--cc-border)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
        {t('inspector.subtitle')}
      </h3>

      <div className="flex flex-col gap-2">
        <Checkbox
          checked={subtitles.enabled}
          label={t('inspector.subtitleEnabled')}
          onCheckedChange={(checked) => setSubtitleSettings({ enabled: checked })}
        />
        <Checkbox
          checked={burnIn}
          label={t('inspector.subtitleBurnIn')}
          onCheckedChange={(checked) => setExportSettings({ burnInSubtitle: checked })}
        />

        <div className="flex items-center gap-2">
          <NumberField
            label={t('inspector.textSize')}
            value={subtitles.style.fontSize}
            min={1}
            max={500}
            step={1}
            onValueChange={(value) => setSubtitleSettings({ style: { fontSize: value } })}
            className="flex-1"
          />
          <NumberField
            label={t('inspector.textStrokeWidth')}
            value={subtitles.style.strokeWidth}
            min={0}
            max={30}
            step={1}
            onValueChange={(value) => setSubtitleSettings({ style: { strokeWidth: value } })}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-1">
            <span className="cc-label">{t('inspector.textColor')}</span>
            <input
              type="color"
              value={subtitles.style.color}
              onChange={(event) => setSubtitleSettings({ style: { color: event.target.value } })}
              className="h-6 w-10 cursor-pointer rounded border border-[var(--cc-border)] bg-transparent"
            />
          </label>
          <span className="cc-label w-16">{t('inspector.textAlign')}</span>
          <Select
            value={subtitles.style.align}
            onValueChange={(value) => setSubtitleSettings({ style: { align: value as TextAlign } })}
            options={[
              { value: 'left', label: '←' },
              { value: 'center', label: '↔' },
              { value: 'right', label: '→' },
            ]}
            ariaLabel={t('inspector.textAlign')}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="cc-label">{t('inspector.subtitleCues')} ({subtitles.cues.length})</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                addSubtitleCue({ startMs: 0, endMs: 2000, text: t('inspector.subtitleAdd') })
              }
            >
              ＋ {t('inspector.subtitleAdd')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const content = stringifySrt(subtitles.cues);
                downloadBlob('subtitles.srt', new Blob([content], { type: 'text/plain' }));
              }}
            >
              {t('inspector.subtitleExport')}
            </Button>
          </div>
        </div>

        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {subtitles.cues.map((cue) => (
            <div key={cue.id} className="rounded border border-[var(--cc-border)] p-1.5">
              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-[var(--cc-fg-muted)]">
                  {formatDuration(cue.startMs)} → {formatDuration(cue.endMs)}
                </span>
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  className="ml-auto text-[10px] text-[var(--cc-danger)]"
                  onClick={() => removeSubtitleCue(cue.id)}
                >
                  ✕
                </button>
              </div>
              <TextField
                value={cue.text}
                multiline
                rows={2}
                onValueChange={(value) => updateSubtitleCue(cue.id, { text: value })}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
