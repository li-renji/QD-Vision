/**
 * 顶部工具栏：工程操作、传输控制、时间码显示、设置入口。
 */

import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from '../common/Button.js';
import { IconButton } from '../common/IconButton.js';
import { Icon } from '../common/Icon.js';
import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { useHistoryStore } from '../../state/historyStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { useUiStore } from '../../state/uiStore.js';
import { unlockPreviewAudio } from '../../services/media/previewAudio.js';
import { exportProjectFile, redo, saveProjectNow, undo } from '../../state/actions.js';
import { toast } from '../common/Toast.js';
import { formatTimecode } from '@clipcut/shared-types';
import { clsx } from '../../utils/clsx.js';

/** 顶部工具栏属性。 */
export interface TopToolbarProps {
  /** 打开设置面板。 */
  onOpenSettings: () => void;
  /** 切换到工程列表。 */
  onOpenProjects: () => void;
}

/**
 * 顶部工具栏。
 */
export function TopToolbar({ onOpenSettings, onOpenProjects }: TopToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const fps = useProjectStore((state) => state.doc.settings.canvas.fps);
  const durationMs = useProjectStore((state) => state.doc.meta.durationMs);
  const dirty = useProjectStore((state) => state.dirty);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const pastCount = useHistoryStore((state) => state.past.length);
  const futureCount = useHistoryStore((state) => state.future.length);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const setSnapEnabled = useUiStore((state) => state.setSnapEnabled);

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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" variant="ghost" aria-label={t('toolbar.exportSave')}>
              {t('toolbar.exportSave')}
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className="z-50 min-w-[180px] rounded border border-[var(--cc-border)] bg-[var(--cc-bg-panel)] p-1 shadow-xl"
            >
              <DropdownMenu.Item
                className="cursor-pointer rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-[var(--cc-bg-elevated)]"
                onSelect={() => {
                  saveProjectNow();
                  toast(t('common.toast.saved'), 'success');
                }}
              >
                {t('menu.save')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="cursor-pointer rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-[var(--cc-bg-elevated)]"
                onSelect={() => {
                  exportProjectFile();
                  toast(t('common.toast.saved'), 'success');
                }}
              >
                {t('menu.exportProject')}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--cc-border)]" />
              <DropdownMenu.Item
                className="cursor-pointer rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-[var(--cc-bg-elevated)]"
                onSelect={() => {
                  useUiStore.getState().setInspectorTab('export');
                  toast(t('menu.exportVideoHint'), 'info');
                }}
              >
                {t('menu.exportVideo')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
          onClick={() => {
            // 必须同步解锁（此刻仍在用户手势栈内）—— 见 PreviewControls 同名处理
            if (!usePlaybackStore.getState().isPlaying) {
              void unlockPreviewAudio();
            }
            usePlaybackStore.getState().togglePlay();
          }}
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
        {/* 吸附开关：拖素材入轨时，同轨片段自动对齐、首条轨第一段对齐 0s。 */}
        <IconButton
          label={snapEnabled ? t('toolbar.snapOn') : t('toolbar.snapOff')}
          onClick={() => setSnapEnabled(!snapEnabled)}
          icon={<Icon name="magnet" size={14} />}
          active={snapEnabled}
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
