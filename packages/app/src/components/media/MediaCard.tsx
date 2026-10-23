/**
 * 素材卡片：缩略图 / 名称 / 类型 / 时长 / 分辨率，HTML5 拖拽源。
 */

import { memo } from 'react';
import type { Asset } from '@clipcut/shared-types';
import { useTranslation } from '../../i18n/index.js';
import { formatBytes, formatResolution } from '../../utils/format.js';
import { formatDuration } from '@clipcut/shared-types';
import { Icon } from '../common/Icon.js';
import { clsx } from '../../utils/clsx.js';

/** 拖拽数据类型。 */
export const ASSET_DRAG_TYPE = 'application/x-clipcut-asset';

/** MediaCard 属性。 */
export interface MediaCardProps {
  asset: Asset;
  selected: boolean;
  view: 'grid' | 'list';
  /** 缩略图 URL（无则 undefined）。 */
  thumbnailUrl?: string | undefined;
  onSelect: (assetId: string, additive: boolean) => void;
  onOpen: (assetId: string) => void;
  onRename: (assetId: string) => void;
  onDelete: (assetId: string) => void;
}

/**
 * 素材卡片。
 */
export const MediaCard = memo(function MediaCard({
  asset,
  selected,
  view,
  thumbnailUrl,
  onSelect,
  onOpen,
  onRename,
  onDelete,
}: MediaCardProps): JSX.Element {
  const { t } = useTranslation();

  const typeLabel =
    asset.type === 'video'
      ? t('media.type.video')
      : asset.type === 'audio'
        ? t('media.type.audio')
        : t('media.type.image');

  const durationLabel =
    asset.durationMs > 0 ? formatDuration(asset.durationMs) : t('media.unknownDuration');

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={(event) => onSelect(asset.id, event.shiftKey || event.ctrlKey || event.metaKey)}
      onDoubleClick={() => onOpen(asset.id)}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          onRename(asset.id);
        }
        if (event.key === 'Delete') {
          event.preventDefault();
          onDelete(asset.id);
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen(asset.id);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={asset.name}
      className={clsx(
        'group relative cursor-pointer rounded border p-1.5 transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cc-accent)]',
        selected
          ? 'border-[var(--cc-accent)] bg-[var(--cc-bg-elevated)]'
          : 'border-[var(--cc-border)] hover:border-[var(--cc-border-strong)]',
        view === 'grid' ? 'flex flex-col gap-1' : 'flex items-center gap-2',
      )}
    >
      <div
        className={clsx(
          'relative flex shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--cc-bg-track)]',
          view === 'grid' ? 'aspect-video w-full' : 'h-9 w-16',
        )}
      >
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={asset.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] text-[var(--cc-fg-muted)]">{typeLabel}</span>
        )}

        {!asset.playable ? (
          <span className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5 text-[9px] text-[var(--cc-warning)]">
            {t('media.needsTranscode')}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[var(--cc-fg-primary)]" title={asset.name}>
          {asset.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--cc-fg-muted)]">
          <span>{typeLabel}</span>
          {asset.type !== 'image' ? <span>· {durationLabel}</span> : null}
          {asset.width && asset.height ? <span>· {formatResolution(asset.width, asset.height)}</span> : null}
          <span>· {formatBytes(asset.sizeBytes, 0)}</span>
        </div>
      </div>

      <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
        <button
          type="button"
          aria-label={t('media.rename')}
          onClick={(event) => {
            event.stopPropagation();
            onRename(asset.id);
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded bg-black/60 text-white transition-colors hover:bg-black/80"
        >
          <Icon name="pencil" size={12} />
        </button>
        <button
          type="button"
          aria-label={t('media.delete')}
          onClick={(event) => {
            event.stopPropagation();
            onDelete(asset.id);
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded bg-black/60 text-[var(--cc-danger)] transition-colors hover:bg-black/80"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
});
