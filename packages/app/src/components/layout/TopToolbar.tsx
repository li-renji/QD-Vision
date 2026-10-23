/**
 * 顶部工具栏：工程操作、传输控制、时间码显示、设置入口。
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '../common/Button.js';
import { IconButton } from '../common/IconButton.js';
import { Icon } from '../common/Icon.js';
import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { useHistoryStore } from '../../state/historyStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { redo, undo } from '../../state/actions.js';
import { formatTimecode } from '@clipcut/shared-types';
import { clsx } from '../../utils/clsx.js';

/** 顶部工具栏属性。 */
export interface TopToolbarProps {
  /** 打开设置面板。 */
  onOpenSettings: () => void;
  /** 切换到工程列表。 */
  onOpenProjects: () => void;
  /** 触发导出。 */
  onExport: () => void;
}

/**
 * 顶部工具栏。
 */
export function TopToolbar({
  onOpenSettings,
  onOpenProjects,
  onExport,
}: TopToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const fps = useProjectStore((state) => state.doc.settings.canvas.fps);
  const durationMs = useProjectStore((state) => state.doc.meta.durationMs);
  const dirty = useProjectStore((state) => state.dirty);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const pastCount = useHistoryStore((state) => state.past.length);
  const futureCount = useHistoryStore((state) => state.future.length);

  // 时间码以 10Hz 节流更新，避免 60Hz 重渲染
  const [timecode, setTimecode] = useState('00:00:00:00');
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      const now = performance.now();
      if (now - lastUpdateRef.current < 100) return;
      lastUpdateRef.current = now;
      setTimecode(formatTimecode(state.currentTimeMs, fps));
    });
  }, [fps]);

  return (
    <header
      className="flex h-toolbar shrink-0 items-center gap-3 border-b border-[var(--cc-border)] bg-[var(--cc-bg-panel)] px-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-semibold tracking-wide text-[var(--cc-fg-primary)]">
          {t('app.name')}
        </span>
        <Button size="sm" variant="ghost" onClick={onOpenProjects}>
          {t('toolbar.open')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onExport}>
          {t('toolbar.export')}
        </Button>
      </div>

      <div className="mx-2 h-5 w-px shrink-0 bg-[var(--cc-border)]" />

      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          label={t('toolbar.toStart')}
          onClick={() => usePlaybackStore.getState().seekToStart(durationMs)}
          icon={<Icon name="skip-start" size={14} />}
        />
        <IconButton
          label={t('toolbar.prevFrame')}
          onClick={() => usePlaybackStore.getState().stepFrame(-1)}
          icon={<Icon name="step-start" size={14} />}
        />
        <IconButton
          label={
            durationMs <= 0
              ? t('preview.emptyTimeline')
              : isPlaying
                ? t('toolbar.pause')
                : t('toolbar.play')
          }
          onClick={() => usePlaybackStore.getState().togglePlay()}
          icon={<Icon name={isPlaying ? 'pause' : 'play'} size={14} />}
          active={isPlaying}
          // 空工程禁用播放（与 PreviewControls 的传输控件保持一致）
          disabled={durationMs <= 0}
        />
        <IconButton
          label={t('toolbar.nextFrame')}
          onClick={() => usePlaybackStore.getState().stepFrame(1)}
          icon={<Icon name="step-end" size={14} />}
        />
        <IconButton
          label={t('toolbar.toEnd')}
          onClick={() => usePlaybackStore.getState().seekToEnd(durationMs)}
          icon={<Icon name="skip-end" size={14} />}
        />
      </div>

      <div className="shrink-0 font-mono text-xs tabular-nums text-[var(--cc-fg-secondary)]">
        {t('toolbar.timecode', {
          current: timecode,
          total: formatTimecode(durationMs, fps),
        })}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          <IconButton
            label={t('toolbar.undo')}
            disabled={pastCount === 0}
            onClick={() => {
              undo();
            }}
            icon={<Icon name="undo" size={14} />}
          />
          <IconButton
            label={t('toolbar.redo')}
            disabled={futureCount === 0}
            onClick={() => {
              redo();
            }}
            icon={<Icon name="redo" size={14} />}
          />
        </div>

        <span
          className={clsx(
            'shrink-0 text-[11px]',
            dirty ? 'text-[var(--cc-warning)]' : 'text-[var(--cc-fg-muted)]',
          )}
        >
          {dirty ? t('toolbar.unsaved') : t('toolbar.saved')}
        </span>

        <Button
          size="sm"
          variant="ghost"
          onClick={onOpenSettings}
          icon={<Icon name="settings" size={14} />}
        >
          {t('toolbar.settings')}
        </Button>
      </div>
    </header>
  );
}
