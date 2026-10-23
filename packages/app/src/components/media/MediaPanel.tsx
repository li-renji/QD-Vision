/**
 * 素材库主面板：本地素材列表 + 导入。
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { useUiStore } from '../../state/uiStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { addClip, removeAsset, updateAsset } from '../../state/actions.js';
import { importFiles } from '../../services/media/assetService.js';
import { getPlatformBridge } from '../../platform/index.js';
import { FILE_ACCEPT } from '../../platform/fileTypes.js';
import { toast } from '../common/Toast.js';
import { EmptyState } from '../common/EmptyState.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { TextField } from '../common/TextField.js';
import { MediaGrid } from './MediaGrid.js';
import { MediaToolbar, type MediaSort } from './MediaToolbar.js';
import { MediaDropZone } from './MediaDropZone.js';
import { useFileDrop } from '../../hooks/useFileDrop.js';
import type { Asset } from '@clipcut/shared-types';

/**
 * 素材库面板。
 */
export function MediaPanel(): JSX.Element {
  const { t } = useTranslation();
  const assets = useProjectStore((state) => state.doc.assets);
  const tracks = useProjectStore((state) => state.doc.tracks);
  const filter = useUiStore((state) => state.mediaFilter);
  const view = useUiStore((state) => state.mediaView);
  const selectedTrackId = useUiStore((state) => state.selectedTrackId);
  const currentTimeMs = usePlaybackStore((state) => state.currentTimeMs);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sort, setSort] = useState<MediaSort>('importedAt');
  const [pendingDelete, setPendingDelete] = useState<Asset | null>(null);
  const [renaming, setRenaming] = useState<Asset | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const list = useMemo(() => {
    const keyword = filter.keyword.trim().toLowerCase();
    const filtered = Object.values(assets).filter((asset) => {
      if (filter.type !== 'all' && asset.type !== filter.type) return false;
      if (keyword.length > 0 && !asset.name.toLowerCase().includes(keyword)) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'duration':
          return b.durationMs - a.durationMs;
        default:
          return b.importedAt.localeCompare(a.importedAt);
      }
    });
  }, [assets, filter, sort]);

  const doImport = useCallback(async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    const result = await importFiles(files);
    if (result.failed > 0) {
      toast(t('media.imported', { imported: result.imported, failed: result.failed }), 'warning');
      for (const reason of result.reasons.slice(0, 3)) {
        toast(reason, 'error');
      }
    } else {
      toast(t('media.imported', { imported: result.imported, failed: 0 }), 'success');
    }
  }, [t]);

  const { isDragging } = useFileDrop({ onFiles: (files) => void doImport(files) });

  const handleSelect = (assetId: string, additive: boolean): void => {
    setSelectedIds((current) => {
      if (!additive) return [assetId];
      return current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId];
    });
  };

  const handleOpen = (assetId: string): void => {
    // 双击 → 追加到时间线播放头处
    const asset = assets[assetId];
    if (!asset) return;
    const track = tracks.find(
      (item) =>
        (item.type === 'audio' && asset.type === 'audio') ||
        (item.type === 'video' && asset.type !== 'audio'),
    );
    if (!track) {
      toast(t('timeline.crossTrackDenied', { type: asset.type, trackType: '—' }), 'warning');
      return;
    }
    const result = addClip({
      assetId,
      trackId: track.id,
      startMs: currentTimeMs,
      inMs: 0,
      ...(asset.durationMs > 0 ? { outMs: asset.durationMs } : {}),
    });
    if (!result.ok && result.error) toast(result.error, 'warning');
  };

  const handleRename = (assetId: string): void => {
    const asset = assets[assetId];
    if (!asset) return;
    setRenaming(asset);
    setRenameValue(asset.name);
  };

  const commitRename = (): void => {
    if (renaming) {
      updateAsset(renaming.id, { name: renameValue.trim() || renaming.name });
    }
    setRenaming(null);
  };

  return (
    <div className="flex h-full flex-col" onDragOver={(event) => event.preventDefault()}>
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-fg-secondary)]">
          {t('media.title')}
        </h2>
        <span className="text-[11px] text-[var(--cc-fg-muted)]">{list.length}</span>
      </div>

      <MediaToolbar
        onImport={() => {
          void getPlatformBridge()
            .readFile({ accept: FILE_ACCEPT.split(','), multiple: true })
            .then((files) => doImport(files))
            .catch(() => {
              /* 用户取消 */
            });
        }}
        onSortChange={setSort}
        sort={sort}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <EmptyState title={t('media.empty')} icon="🎞" />
        ) : (
          <MediaGrid
            assets={list}
            selectedIds={selectedIds}
            view={view}
            onSelect={handleSelect}
            onOpen={handleOpen}
            onRename={handleRename}
            onDelete={(assetId) => {
              const asset = assets[assetId];
              if (asset) setPendingDelete(asset);
            }}
          />
        )}
      </div>

      <MediaDropZone active={isDragging} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('media.delete')}
        description={
          pendingDelete ? t('media.deleteConfirm', { name: pendingDelete.name }) : undefined
        }
        danger
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (pendingDelete) {
            removeAsset(pendingDelete.id);
            setSelectedIds((current) => current.filter((id) => id !== pendingDelete.id));
          }
        }}
      />

      <ConfirmDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title={t('media.rename')}
        confirmLabel={t('common.ok')}
        onConfirm={commitRename}
      >
        <TextField
          value={renameValue}
          onValueChange={setRenameValue}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
          }}
        />
      </ConfirmDialog>

      <div className="border-t border-[var(--cc-border)] p-1">
        <span className="text-[10px] text-[var(--cc-fg-muted)]">
          {selectedTrackId ? '' : t('timeline.empty')}
        </span>
      </div>
    </div>
  );
}
