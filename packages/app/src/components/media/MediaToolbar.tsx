/**
 * 素材工具栏：搜索框（200ms 防抖）、类型筛选、排序、视图切换。
 *
 * ## 为什么是两行
 *
 * 素材面板宽度可拖拽，范围 **160 ~ 无上限**（`uiStore.setPanelWidth` 下限 160px）。
 * 单行塞「搜索 + 类型筛选 + 排序 + 视图切换 + 导入」在 160px 下需要 ~316px，
 * 必然溢出面板右边界（`AppLayout` 的 `overflow-hidden` 会把它直接切掉）。
 *
 * 现在拆成两行：
 * - 第 1 行：搜索框独占整行（`min-w-0` 保证再窄也能收缩到 0 而不是撑破布局）；
 * - 第 2 行：两个 `Select` 用 `flex-1 min-w-0` 均分剩余宽度，视图切换按钮 `shrink-0`。
 *
 * 极端窄（160px）时两个下拉的标签会省略号截断 —— 这是可接受的降级，
 * 关键是**任何元素都不会溢出面板**。导入按钮已上移到 `MediaPanel` 的标题行。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { useUiStore } from '../../state/uiStore.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { Select } from '../common/Select.js';
import { debounce } from '../../utils/throttle.js';
import type { AssetType } from '@clipcut/shared-types';

/** 排序方式。 */
export type MediaSort = 'name' | 'duration' | 'importedAt';

/** MediaToolbar 属性。 */
export interface MediaToolbarProps {
  /** 排序变化。 */
  onSortChange: (sort: MediaSort) => void;
  sort: MediaSort;
}

/**
 * 素材工具栏。
 */
export function MediaToolbar({ onSortChange, sort }: MediaToolbarProps): JSX.Element {
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
    <div className="flex flex-col gap-1.5 border-b border-[var(--cc-border)] p-2">
      <input
        type="search"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t('media.search')}
        aria-label={t('media.search')}
        className="cc-input w-full min-w-0"
      />
      <div className="flex min-w-0 items-center gap-1">
        <Select
          value={filter.type}
          onValueChange={(value) => setMediaFilter({ type: value as AssetType | 'all' })}
          options={[
            { value: 'all', label: t('media.filter.all') },
            { value: 'video', label: t('media.filter.video') },
            { value: 'audio', label: t('media.filter.audio') },
            { value: 'image', label: t('media.filter.image') },
          ]}
          className="min-w-0 flex-1"
          minWidth={0}
          ariaLabel={t('media.filter.all')}
        />
        <Select
          value={sort}
          onValueChange={(value) => onSortChange(value as MediaSort)}
          options={[
            { value: 'importedAt', label: t('media.sort.importedAt') },
            { value: 'name', label: t('media.sort.name') },
            { value: 'duration', label: t('media.sort.duration') },
          ]}
          className="min-w-0 flex-1"
          minWidth={0}
          ariaLabel={t('media.sort.label')}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setMediaView(view === 'grid' ? 'list' : 'grid')}
          aria-label={view === 'grid' ? t('media.view.list') : t('media.view.grid')}
          title={view === 'grid' ? t('media.view.list') : t('media.view.grid')}
          className="shrink-0"
          icon={<Icon name={view === 'grid' ? 'list' : 'grid'} size={14} />}
        />
      </div>
    </div>
  );
}