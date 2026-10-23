/**
 * 素材工具栏：搜索框（200ms 防抖）、类型筛选、排序、导入按钮。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { useUiStore } from '../../state/uiStore.js';
import { Button } from '../common/Button.js';
import { Select } from '../common/Select.js';
import { debounce } from '../../utils/throttle.js';
import type { AssetType } from '@clipcut/shared-types';

/** 排序方式。 */
export type MediaSort = 'name' | 'duration' | 'importedAt';

/** MediaToolbar 属性。 */
export interface MediaToolbarProps {
  onImport: () => void;
  /** 排序变化。 */
  onSortChange: (sort: MediaSort) => void;
  sort: MediaSort;
}

/**
 * 素材工具栏。
 */
export function MediaToolbar({ onImport, onSortChange, sort }: MediaToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const filter = useUiStore((state) => state.mediaFilter);
  const setMediaFilter = useUiStore((state) => state.setMediaFilter);
  const view = useUiStore((state) => state.mediaView);
  const setMediaView = useUiStore((state) => state.setMediaView);

  const [keyword, setKeyword] = useState(filter.keyword);

  // 200ms 防抖
  useEffect(() => {
    const debounced = debounce((value: string) => {
      setMediaFilter({ keyword: value });
    }, 200);
    debounced(keyword);
    return () => debounced.cancel();
  }, [keyword, setMediaFilter]);

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--cc-border)] p-2">
      <div className="flex items-center gap-1">
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('media.search')}
          className="cc-input flex-1"
        />
        <Select
          value={filter.type}
          onValueChange={(value) => setMediaFilter({ type: value as AssetType | 'all' })}
          options={[
            { value: 'all', label: t('media.filter.all') },
            { value: 'video', label: t('media.filter.video') },
            { value: 'audio', label: t('media.filter.audio') },
            { value: 'image', label: t('media.filter.image') },
          ]}
          ariaLabel={t('media.filter.all')}
        />
        <Select
          value={sort}
          onValueChange={(value) => onSortChange(value as MediaSort)}
          options={[
            { value: 'importedAt', label: '🕒' },
            { value: 'name', label: 'A-Z' },
            { value: 'duration', label: '⏱' },
          ]}
          ariaLabel="sort"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setMediaView(view === 'grid' ? 'list' : 'grid')}
          aria-label={view === 'grid' ? t('media.view.list') : t('media.view.grid')}
        >
          {view === 'grid' ? '☰' : '▦'}
        </Button>
        <Button size="sm" variant="primary" onClick={onImport}>
          ＋ {t('media.import')}
        </Button>
      </div>
    </div>
  );
}
