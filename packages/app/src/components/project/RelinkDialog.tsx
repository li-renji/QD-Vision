/**
 * 离线素材重新定位（relink，FR-004②）。
 */

import { useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { updateAsset } from '../../state/actions.js';
import { getPlatformBridge } from '../../platform/index.js';
import { putBlob } from '../../services/storage/blobRepo.js';
import { BlobKeys } from '../../services/storage/db.js';
import { probeMedia } from '../../services/media/metadataProbe.js';
import { Dialog } from '../common/Dialog.js';
import { Button } from '../common/Button.js';
import { toast } from '../common/Toast.js';

/** RelinkDialog 属性。 */
export interface RelinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待重新定位的素材 id */
  assetId: string | null;
}

/**
 * 重新定位素材对话框。
 */
export function RelinkDialog({ open, onOpenChange, assetId }: RelinkDialogProps): JSX.Element {
  const { t } = useTranslation();
  const assets = useProjectStore((state) => state.doc.assets);
  const [busy, setBusy] = useState(false);

  const asset = assetId ? assets[assetId] : undefined;

  const relink = (): void => {
    if (!asset) return;
    setBusy(true);
    void getPlatformBridge()
      .readFile({ multiple: false })
      .then(async (files) => {
        const file = files[0];
        if (!file) return;

        const blobKey = BlobKeys.asset(asset.id);
        await putBlob(blobKey, file);
        const metadata = await probeMedia(file, asset.type);

        updateAsset(asset.id, {
          blobKey,
          name: file.name,
          sizeBytes: file.size,
          durationMs: metadata.durationMs || asset.durationMs,
          width: metadata.width ?? asset.width,
          height: metadata.height ?? asset.height,
          playable: metadata.playable,
        });

        toast(t('project.relink.restored', { count: 1 }), 'success');
        onOpenChange(false);
      })
      .catch(() => {
        /* 用户取消 */
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.relink.title')}
      description={t('project.relink.description')}
      className="w-[min(460px,92vw)]"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('project.relink.skip')}
          </Button>
          <Button variant="primary" loading={busy} onClick={relink}>
            {t('project.relink.relink')}
          </Button>
        </>
      }
    >
      <p className="text-xs text-[var(--cc-fg-secondary)]">
        {asset?.name ?? '—'} · {t('project.relink.missing')}
      </p>
    </Dialog>
  );
}
