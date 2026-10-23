/**
 * 浏览器能力与编码器矩阵展示（FR-044 / FR-060）。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { getPlatformBridge } from '../../platform/index.js';
import type { PlatformCapabilities } from '../../platform/PlatformBridge.js';
import { probeCodecMatrix, type CodecMatrix } from '../../services/export/capabilityProbe.js';

/**
 * 能力页。
 */
export function CapabilitiesTab(): JSX.Element {
  const { t } = useTranslation();
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);
  const [matrix, setMatrix] = useState<CodecMatrix | null>(null);

  useEffect(() => {
    void getPlatformBridge().capability().then(setCapabilities);
    void probeCodecMatrix().then(setMatrix);
  }, []);

  const rows: Array<{ label: string; value: string; ok: boolean }> = capabilities
    ? [
        {
          label: 'File System Access API',
          value: capabilities.fileSystemAccess ? '✓' : '✗',
          ok: capabilities.fileSystemAccess,
        },
        {
          label: 'WebCodecs',
          value: capabilities.webCodecs ? '✓' : '✗',
          ok: capabilities.webCodecs,
        },
        {
          label: 'MediaRecorder',
          value: capabilities.mediaRecorder ? '✓' : '✗',
          ok: capabilities.mediaRecorder,
        },
        { label: 'WebGPU', value: capabilities.webGpu ? '✓' : '✗', ok: capabilities.webGpu },
        {
          label: 'IndexedDB',
          value: capabilities.indexedDb ? '✓' : '✗',
          ok: capabilities.indexedDb,
        },
        {
          label: 'Mobile',
          value: capabilities.isMobile ? '✓' : '✗',
          ok: !capabilities.isMobile,
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 p-3">
      <section>
        <h4 className="cc-label mb-1">{t('settings.capabilityTitle')}</h4>
        <ul className="flex flex-col gap-0.5 text-[11px]">
          {rows.map((row) => (
            <li key={row.label} className="flex justify-between">
              <span className="text-[var(--cc-fg-secondary)]">{row.label}</span>
              <span className={row.ok ? 'text-[var(--cc-success)]' : 'text-[var(--cc-warning)]'}>
                {row.value}
              </span>
            </li>
          ))}
        </ul>
        {capabilities ? (
          <p className="mt-1 break-all text-[10px] text-[var(--cc-fg-muted)]">
            {capabilities.userAgent}
          </p>
        ) : null}
      </section>

      {matrix ? (
        <section>
          <h4 className="cc-label mb-1">{t('export.capabilities')}</h4>
          <ul className="flex flex-col gap-0.5 text-[11px]">
            {(['h264', 'hevc', 'vp9', 'av1'] as const).map((key) => (
              <li key={key} className="flex justify-between">
                <span className="uppercase text-[var(--cc-fg-secondary)]">{key}</span>
                <span
                  className={matrix.video[key].supported ? 'text-[var(--cc-success)]' : 'text-[var(--cc-fg-muted)]'}
                >
                  {matrix.video[key].supported ? t('export.supported') : t('export.unsupported')}
                </span>
              </li>
            ))}
            {(['aac', 'opus'] as const).map((key) => (
              <li key={key} className="flex justify-between">
                <span className="uppercase text-[var(--cc-fg-secondary)]">{key}</span>
                <span
                  className={matrix.audio[key].supported ? 'text-[var(--cc-success)]' : 'text-[var(--cc-fg-muted)]'}
                >
                  {matrix.audio[key].supported ? t('export.supported') : t('export.unsupported')}
                </span>
              </li>
            ))}
            <li className="flex justify-between">
              <span className="uppercase text-[var(--cc-fg-secondary)]">webm</span>
              <span className={matrix.recorder.webm ? 'text-[var(--cc-success)]' : 'text-[var(--cc-fg-muted)]'}>
                {matrix.recorder.webm ? t('export.supported') : t('export.unsupported')}
              </span>
            </li>
          </ul>
          <p className="mt-1 text-[10px] text-[var(--cc-fg-muted)]">{matrix.preferredExport.reason}</p>
        </section>
      ) : null}

      <section>
        <h4 className="cc-label mb-1">{t('settings.compatTitle')}</h4>
        <ul className="list-disc pl-4 text-[11px] text-[var(--cc-fg-secondary)]">
          <li>{t('settings.compatChrome')}</li>
          <li>{t('settings.compatSafari')}</li>
          <li>{t('settings.compatFirefox')}</li>
        </ul>
      </section>
    </div>
  );
}
