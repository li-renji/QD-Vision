/**
 * 导入 `.clipcut.json`：校验 `schemaVersion`、高版本拒绝提示、离线缺失报告。
 */

import { useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { deserialize } from '../../domain/project/deserialize.js';
import { UnsupportedSchemaVersionError } from '../../domain/project/migrate.js';
import { getMissingBlobKeys } from '../../services/storage/blobRepo.js';
import { getPlatformBridge } from '../../platform/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { saveProject } from '../../services/storage/projectRepo.js';
import { Dialog } from '../common/Dialog.js';
import { Button } from '../common/Button.js';
import { toast } from '../common/Toast.js';

/** ImportProjectDialog 属性。 */
export interface ImportProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 导入成功。 */
  onImported: (projectId: string, missingCount: number) => void;
}

/**
 * 导入工程对话框。
 */
export function ImportProjectDialog({
  open,
  onOpenChange,
  onImported,
}: ImportProjectDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [missingCount] = useState(0);

  const pickAndImport = (): void => {
    void getPlatformBridge()
      .readFile({ accept: ['application/json'], multiple: false })
      .then(async (files) => {
        const file = files[0];
        if (!file) return;
        setError(null);

        let json: unknown;
        try {
          json = JSON.parse(await file.text()) as unknown;
        } catch (parseError) {
          setError(
            t('project.import.invalid', {
              reason: parseError instanceof Error ? parseError.message : String(parseError),
            }),
          );
          return;
        }

        let doc;
        try {
          doc = deserialize(json);
        } catch (deserializeError) {
          if (deserializeError instanceof UnsupportedSchemaVersionError) {
            setError(
              t('project.import.tooNew', {
                version: deserializeError.fileVersion,
                supported: deserializeError.supportedVersion,
              }),
            );
            return;
          }
          setError(
            t('project.import.invalid', {
              reason: deserializeError instanceof Error ? deserializeError.message : String(deserializeError),
            }),
          );
          return;
        }

        const blobKeys = Object.values(doc.assets)
          .map((asset) => asset.blobKey)
          .filter((key): key is string => typeof key === 'string');
        const missing = await getMissingBlobKeys(blobKeys);

        await saveProject(doc);
        useProjectStore.getState().setDoc(doc, { markDirty: false });

        if (missing.length > 0) {
          toast(t('project.import.missingAssets', { count: missing.length }), 'warning');
        } else {
          toast(t('project.import.ok'), 'success');
        }

        onImported(doc.projectId, missing.length);
        onOpenChange(false);
      })
      .catch(() => {
        /* 用户取消 */
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.import.title')}
      className="w-[min(460px,92vw)]"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={pickAndImport}>
            {t('project.import.select')}
          </Button>
        </>
      }
    >
      <p className="text-xs text-[var(--cc-fg-secondary)]">
        {t('project.import.select')}
      </p>
      {error ? (
        <p className="mt-2 rounded border border-[var(--cc-danger)] p-2 text-[11px] text-[var(--cc-danger)]">
          {error}
        </p>
      ) : null}
      {missingCount > 0 ? (
        <p className="mt-2 text-[11px] text-[var(--cc-warning)]">
          {t('project.import.missingAssets', { count: missingCount })}
        </p>
      ) : null}
    </Dialog>
  );
}
