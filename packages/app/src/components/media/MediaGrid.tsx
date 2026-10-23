/**
 * 素材网格 / 列表（缩略图懒加载用 IntersectionObserver）。
 */

import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@clipcut/shared-types';
import { MediaCard } from './MediaCard.js';
import { clsx } from '../../utils/clsx.js';
import { getBlobByKey } from '../../services/storage/blobRepo.js';

/** MediaGrid 属性。 */
export interface MediaGridProps {
  assets: Asset[];
  selectedIds: readonly string[];
  view: 'grid' | 'list';
  onSelect: (assetId: string, additive: boolean) => void;
  onOpen: (assetId: string) => void;
  onRename: (assetId: string) => void;
  onDelete: (assetId: string) => void;
}

/**
 * 缩略图懒加载 Hook：元素进入视口后才读取 blob。
 */
function useThumbnail(asset: Asset, enabled: boolean): string | undefined {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled || visible) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, visible]);

  useEffect(() => {
    if (!visible || !asset.thumbnailBlobKey) return;
    let revoked = false;
    let objectUrl: string | undefined;
    void getBlobByKey(asset.thumbnailBlobKey).then((blob) => {
      if (!blob || revoked) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, asset.thumbnailBlobKey]);

  return url;
}

/** 包装卡片以支持懒加载。 */
function LazyCard(props: Omit<Parameters<typeof MediaCard>[0], 'thumbnailUrl'>): JSX.Element {
  const { asset } = props;
  const url = useThumbnail(asset, true);
  return <MediaCard {...props} thumbnailUrl={url} />;
}

/**
 * 素材网格。
 */
export function MediaGrid({
  assets,
  selectedIds,
  view,
  onSelect,
  onOpen,
  onRename,
  onDelete,
}: MediaGridProps): JSX.Element {
  return (
    <div
      className={clsx(
        'grid gap-2 p-2',
        view === 'grid' ? 'grid-cols-[repeat(auto-fill,minmax(132px,1fr))]' : 'grid-cols-1',
      )}
    >
      {assets.map((asset) => (
        <LazyCard
          key={asset.id}
          asset={asset}
          selected={selectedIds.includes(asset.id)}
          view={view}
          onSelect={onSelect}
          onOpen={onOpen}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
