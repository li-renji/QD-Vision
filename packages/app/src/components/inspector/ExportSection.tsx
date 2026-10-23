/**
 * 导出设置：分辨率 / 帧率 / 格式 / 码率 + 编码器能力矩阵 + 开始导出 + 进度 + 历史。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { setExportSettings } from '../../state/actions.js';
import { buildExportPlan } from '../../domain/export/exportPlan.js';
import { probeCodecMatrix, type CodecMatrix } from '../../services/export/capabilityProbe.js';
import { exportController, type ExportJob } from '../../services/export/exportController.js';
import { listExportHistory } from '../../services/storage/exportHistoryRepo.js';
import type { ExportRecord } from '../../services/storage/db.js';
import { formatBytes, formatDateTime } from '../../utils/format.js';
import { formatDuration } from '@clipcut/shared-types';
import { Select } from '../common/Select.js';
import { NumberField } from '../common/NumberField.js';
import { Button } from '../common/Button.js';
import { toast } from '../common/Toast.js';
import type { ExportFormat } from '@clipcut/shared-types';

/**
 * 导出分区。
 */
export function ExportSection(): JSX.Element {
  const { t } = useTranslation();
  const doc = useProjectStore((state) => state.doc);
  const exportSettings = useProjectStore((state) => state.doc.settings.export);

  const [matrix, setMatrix] = useState<CodecMatrix | null>(null);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [history, setHistory] = useState<ExportRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    void probeCodecMatrix().then((result) => {
      if (!cancelled) setMatrix(result);
    });
    void listExportHistory().then((records) => {
      if (!cancelled) setHistory(records);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 当前工程的 fps 可能是合法但不在预设列表里的值（如 10、15、120）。
  // 这种情况下显式补一个「自定义」选项，避免下拉框显示空白 —— 空白会让用户
  // 误以为导出用了别的帧率（实际导出用的就是当前 fps）。
  const FPS_PRESETS = [24, 25, 30, 50, 60] as const;
  const fpsOptions = FPS_PRESETS.map((fps) => ({ value: String(fps), label: `${fps}` }));
  if (!FPS_PRESETS.includes(exportSettings.fps as (typeof FPS_PRESETS)[number])) {
    fpsOptions.push({ value: String(exportSettings.fps), label: `${exportSettings.fps} (${t('export.fpsCustom')})` });
  }

  const plan = buildExportPlan(doc, {
    width: exportSettings.width,
    height: exportSettings.height,
    fps: exportSettings.fps,
    format: exportSettings.format,
    videoBitrate: exportSettings.videoBitrate,
    audioBitrate: exportSettings.audioBitrate,
    burnInSubtitle: exportSettings.burnInSubtitle,
  });

  const startExport = (): void => {
    void exportController
      .start({
        doc,
        format: exportSettings.format,
        width: exportSettings.width,
        height: exportSettings.height,
        fps: exportSettings.fps,
        videoBitrate: exportSettings.videoBitrate,
        audioBitrate: exportSettings.audioBitrate,
        burnInSubtitle: exportSettings.burnInSubtitle,
        getFrame: async () => null,
        audioBuffer: null,
        onProgress: (next) => setJob(next),
        onComplete: (next) => {
          setJob(next);
          toast(t('export.done'), 'success');
          void listExportHistory().then(setHistory);
        },
      })
      .then((result) => {
        setJob(result);
        if (result.status === 'failed' && result.error) {
          toast(t('export.failed', { reason: result.error }), 'error');
        }
      });
  };

  return (
    <section className="p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
        {t('inspector.export')}
      </h3>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('export.resolution')}</span>
          <Select
            value={String(exportSettings.width)}
            onValueChange={(value) => {
              const width = Number(value);
              const height = Math.round((width / 16) * 9);
              setExportSettings({ width, height });
            }}
            options={[
              { value: '1280', label: t('export.resolution.720p') },
              { value: '1920', label: t('export.resolution.1080p') },
              { value: '3840', label: t('export.resolution.4k') },
            ]}
            ariaLabel={t('export.resolution')}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('export.fps')}</span>
          <Select
            value={String(exportSettings.fps)}
            onValueChange={(value) => setExportSettings({ fps: Number(value) })}
            options={fpsOptions}
            ariaLabel={t('export.fps')}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="cc-label w-16">{t('export.format')}</span>
          <Select
            value={exportSettings.format}
            onValueChange={(value) => setExportSettings({ format: value as ExportFormat })}
            options={[
              { value: 'mp4', label: t('export.format.mp4') },
              { value: 'webm', label: t('export.format.webm') },
            ]}
            ariaLabel={t('export.format')}
          />
        </div>

        <div className="flex items-center gap-2">
          <NumberField
            label={t('export.videoBitrate')}
            value={exportSettings.videoBitrate}
            min={0}
            step={500_000}
            unit="bps"
            onValueChange={(value) => setExportSettings({ videoBitrate: value })}
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2">
          <NumberField
            label={t('export.audioBitrate')}
            value={exportSettings.audioBitrate}
            min={0}
            step={16_000}
            unit="bps"
            onValueChange={(value) => setExportSettings({ audioBitrate: value })}
            className="flex-1"
          />
        </div>

        {plan.errors.length > 0 ? (
          <div className="rounded border border-[var(--cc-warning)] p-2 text-[11px] text-[var(--cc-warning)]">
            {plan.errors.map((error) => (
              <p key={error}>{t('export.invalidCombination', { reason: error })}</p>
            ))}
            {plan.suggestions.map((suggestion) => (
              <p key={suggestion} className="text-[var(--cc-fg-secondary)]">
                {t('export.suggestion', { suggestion })}
              </p>
            ))}
          </div>
        ) : null}

        {job ? (
          <div className="rounded border border-[var(--cc-border)] p-2">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span>
                {t('export.progress', { ratio: `${Math.round(job.progress * 100)}%` })}
              </span>
              <span className="text-[var(--cc-fg-muted)]">
                {t('export.remaining', { time: formatDuration(job.estimatedRemainingMs) })}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--cc-bg-track)]">
              <div
                className="h-full bg-[var(--cc-accent)] transition-[width]"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
            {job.warnings.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-[10px] text-[var(--cc-warning)]">
                {job.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            disabled={job?.status === 'running'}
            onClick={startExport}
          >
            {t('export.start')}
          </Button>
          {job?.status === 'running' ? (
            <Button variant="danger" onClick={() => exportController.cancel()}>
              {t('export.cancel')}
            </Button>
          ) : null}
        </div>

        {matrix ? (
          <div className="rounded border border-[var(--cc-border)] p-2">
            <div className="cc-label mb-1">{t('export.capabilities')}</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
              {(['h264', 'hevc', 'vp9', 'av1'] as const).map((key) => (
                <span key={key} className="flex justify-between">
                  <span className="uppercase">{key}</span>
                  <span
                    className={
                      matrix.video[key].supported ? 'text-[var(--cc-success)]' : 'text-[var(--cc-fg-muted)]'
                    }
                  >
                    {matrix.video[key].supported
                      ? t('export.supported')
                      : t('export.unsupported')}
                  </span>
                </span>
              ))}
              {(['aac', 'opus'] as const).map((key) => (
                <span key={key} className="flex justify-between">
                  <span className="uppercase">{key}</span>
                  <span
                    className={
                      matrix.audio[key].supported ? 'text-[var(--cc-success)]' : 'text-[var(--cc-fg-muted)]'
                    }
                  >
                    {matrix.audio[key].supported
                      ? t('export.supported')
                      : t('export.unsupported')}
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-[var(--cc-fg-muted)]">
              {matrix.preferredExport.reason}
            </p>
          </div>
        ) : null}

        <div className="rounded border border-[var(--cc-border)] p-2">
          <div className="cc-label mb-1">{t('export.history')}</div>
          {history.length === 0 ? (
            <p className="text-[10px] text-[var(--cc-fg-muted)]">{t('export.historyEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-[10px]">
              {history.map((record) => (
                <li key={record.id} className="flex justify-between text-[var(--cc-fg-secondary)]">
                  <span>
                    {record.format.toUpperCase()} · {formatBytes(record.sizeBytes)} ·{' '}
                    {formatDuration(record.durationMs)}
                  </span>
                  <span className="text-[var(--cc-fg-muted)]">{formatDateTime(record.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
