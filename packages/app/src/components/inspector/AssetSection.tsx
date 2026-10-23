/**
 * 素材属性：路径、许可、离线缺失提示与 relink 入口。
 */

import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { usePrimarySelectedClip } from '../../state/selectors.js';
import { formatBytes, formatDateTime, formatResolution } from '../../utils/format.js';
import { hasBlob } from '../../services/storage/blobRepo.js';
import { useEffect, useState } from 'react';
import { Button } from '../common/Button.js';

/** AssetSection 属性。 */
export interface AssetSectionProps {
  /** 请求重新定位素材。 */
  onRelink?: (assetId: string) => void;
}

/**
 * 素材属性分区。
 */
export function AssetSection({ onRelink }: AssetSectionProps): JSX.Element | null {
  const { t } = useTranslation();
  const clip = usePrimarySelectedClip();
  const assets = useProjectStore((state) => state.doc.assets);
  const [missing, setMissing] = useState(false);

  const asset = clip?.assetId ? assets[clip.assetId] : undefined;

  useEffect(() => {
    if (!asset?.blobKey) {
      setMissing(false);
      return;
    }
    let cancelled = false;
    void hasBlob(asset.blobKey).then((exists) => {
      if (!cancelled) setMissing(!exists);
    });
    return () => {
      cancelled = true;
    };
  }, [asset?.blobKey]);

  if (!asset) return null;

  return (
    <section className="border-b border-[var(--cc-border)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
        {t('inspector.asset')}
      </h3>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
        <dt className="cc-label">{t('inspector.assetPath')}</dt>
        <dd className="truncate text-[var(--cc-fg-primary)]">{asset.blobKey ?? '—'}</dd>

        <dt className="cc-label">{t('media.type.' + asset.type)}</dt>
        <dd className="text-[var(--cc-fg-primary)]">
          {formatResolution(asset.width, asset.height)} · {formatBytes(asset.sizeBytes)}
        </dd>

        <dt className="cc-label">{t('media.imported')}</dt>
        <dd className="text-[var(--cc-fg-primary)]">{formatDateTime(asset.importedAt)}</dd>

        <dt className="cc-label">{t('inspector.assetLicense')}</dt>
        <dd className="text-[var(--cc-fg-primary)]">
          {asset.license ? `${asset.license.source} · ${asset.license.name}` : t('common.none')}
        </dd>
      </dl>

      {missing ? (
        <div className="mt-2 rounded border border-[var(--cc-warning)] p-2">
          <p className="mb-1 text-[11px] text-[var(--cc-warning)]">
            {t('inspector.assetMissing')}
          </p>
          {onRelink ? (
            <Button size="sm" variant="primary" onClick={() => onRelink(asset.id)}>
              {t('project.relink.relink')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!asset.playable ? (
        <p className="mt-2 text-[11px] text-[var(--cc-warning)]">{t('media.needsTranscode')}</p>
      ) : null}
    </section>
  );
}
