/**
 * 轨道头：名称 / 静音 / 隐藏 / 锁定 / 高度，粘性固定不随横向滚动。
 *
 * ## 布局约定（与 `TrackRow` 严格对齐）
 *
 * 轨道头与轨道行是**两列并排**结构，因此轨道头的高度必须等于
 * `track.height`（由 `TrackRow` 的行内 `style.height` 决定）。
 *
 * ⚠️ 历史缺陷：这里曾用 `h-full`。`h-full` = `height:100%`，在
 * `TimelinePanel` 的轨道头列（`flex-col`，无显式高度）里会解析成
 * **"占满父容器"** 而不是 "占满本轨道行"，导致所有轨道头等高拉伸、
 * 与右侧轨道行逐个错位（探针实测：轨道头 top=600/948/1272…，
 * 轨道行 top=624/688/752…，第 2 个轨道头就已经下移了 260px）。
 * 现在改为与 `TrackRow` 同样使用行内 `style={{ height: track.height }}`。
 *
 * ## 交互
 *
 * - 右键唤出轨道菜单（{@link TrackContextMenu}）；
 * - 双击名称进入行内重命名；
 * - 删除轨道走二次确认（对话框活在菜单外，避免随菜单关闭被卸载）。
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import type { Track } from '@clipcut/shared-types';
import { IconButton } from '../common/IconButton.js';
import { Icon } from '../common/Icon.js';
import { ContextMenu } from '../common/ContextMenu.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { reorderTrack, removeTrack, renameTrack, setTrackFlags } from '../../state/actions.js';
import { TrackContextMenu } from './TrackContextMenu.js';
import { useProjectStore } from '../../state/projectStore.js';
import { clsx } from '../../utils/clsx.js';

/** TrackHeader 属性。 */
export interface TrackHeaderProps {
  track: Track;
  selected: boolean;
  onSelect: (trackId: string, additive?: boolean) => void;
}

/** 轨道类型 → 单字母标识（V/A/T/S）。 */
function typeBadge(type: Track['type']): string {
  return type === 'video' ? 'V' : type === 'audio' ? 'A' : type === 'subtitle' ? 'S' : 'T';
}

/**
 * 轨道头。
 */
export function TrackHeader({ track, selected, onSelect }: TrackHeaderProps): JSX.Element {
  const { t } = useTranslation();
  const badge = typeBadge(track.type);
  const tracks = useProjectStore((state) => state.doc.tracks);
  const maxOrder = tracks.reduce((max, item) => Math.max(max, item.order), 0);
  const canMoveUp = track.order > 0;
  const canMoveDown = track.order < maxOrder;

  // 行内重命名状态。
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(track.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 删除轨道二次确认。
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startRename = (): void => {
    setDraftName(track.name);
    setEditing(true);
  };

  const commitRename = (): void => {
    setEditing(false);
    const next = draftName.trim();
    if (next.length === 0 || next === track.name) return;
    const result = renameTrack(track.id, next);
    if (!result.ok && result.error) {
      // 名称非法（如重名/为空）时保持原状，仅提示。
      setDraftName(track.name);
    }
  };

  const cancelRename = (): void => {
    setEditing(false);
    setDraftName(track.name);
  };

  return (
    <>
      <ContextMenu
        content={
          <TrackContextMenu
            track={track}
            onRequestRename={startRename}
            onRequestDelete={() => setConfirmDeleteOpen(true)}
          />
        }
      >
        <div
          data-track-header={track.id}
          className={clsx(
            'flex w-trackhead shrink-0 flex-col justify-center gap-0.5 border-b border-[var(--cc-border)] px-2',
            selected ? 'bg-[var(--cc-bg-elevated)]' : 'bg-[var(--cc-bg-panel)]',
          )}
          // ⚠️ 必须与 TrackRow 的高度来源一致，否则轨道头与轨道行会整体错位。
          style={{ height: track.height }}
          onClick={(event) => {
            if (!editing) onSelect(track.id, event.ctrlKey || event.metaKey || event.shiftKey);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !editing) onSelect(track.id);
          }}
        >
        {/* 名称行：徽标 + 名称。名称独占剩余宽度，图标区固定宽不参与挤压。 */}
        <div className="flex min-w-0 items-center gap-1">
          <span
            className={clsx(
              'shrink-0 rounded px-1 text-[10px] font-semibold leading-4',
              selected ? 'bg-[var(--cc-accent)] text-white' : 'text-[var(--cc-fg-muted)]',
            )}
            aria-hidden="true"
          >
            {badge}
          </span>
          {editing ? (
            <input
              ref={inputRef}
              autoFocus
              className="min-w-0 flex-1 rounded border border-[var(--cc-accent)] bg-[var(--cc-bg)] px-1 text-[12px] leading-4 text-[var(--cc-fg-primary)] outline-none"
              value={draftName}
              aria-label={t('timeline.renameTrack')}
              onChange={(event) => setDraftName(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') cancelRename();
              }}
              onBlur={commitRename}
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[var(--cc-fg-primary)]"
              title={`${track.name}（双击重命名）`}
              onDoubleClick={(event) => {
                event.stopPropagation();
                startRename();
              }}
            >
              {track.name}
            </span>
          )}
        </div>

        {/* 操作行：片段数 + 开关组。`shrink-0` 保证图标永不被压成竖条。 */}
        <div className="flex min-w-0 items-center justify-between gap-1">
          <span className="shrink-0 text-[10px] leading-4 tabular-nums text-[var(--cc-fg-muted)]">
            {track.clips.length} {t('timeline.clips')}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              size="xs"
              label={t('timeline.moveUp')}
              disabled={!canMoveUp}
              onClick={() => reorderTrack(track.id, 'up')}
              icon={<Icon name="chevron-up" size={13} />}
            />
            <IconButton
              size="xs"
              label={t('timeline.moveDown')}
              disabled={!canMoveDown}
              onClick={() => reorderTrack(track.id, 'down')}
              icon={<Icon name="chevron-down" size={13} />}
            />
            <IconButton
              size="xs"
              label={track.muted ? t('timeline.unmute') : t('timeline.mute')}
              active={track.muted}
              onClick={() => setTrackFlags(track.id, { muted: !track.muted })}
              icon={<Icon name={track.muted ? 'volume-off' : 'volume-on'} size={13} />}
            />
            {track.type === 'video' ? (
              <IconButton
                size="xs"
                label={track.hidden ? t('timeline.show') : t('timeline.hide')}
                active={track.hidden}
                onClick={() => setTrackFlags(track.id, { hidden: !track.hidden })}
                icon={<Icon name={track.hidden ? 'eye-off' : 'eye'} size={13} />}
              />
            ) : null}
            <IconButton
              size="xs"
              label={track.locked ? t('timeline.unlock') : t('timeline.lock')}
              active={track.locked}
              onClick={() => setTrackFlags(track.id, { locked: !track.locked })}
              icon={<Icon name={track.locked ? 'lock' : 'unlock'} size={13} />}
            />
            <IconButton
              size="xs"
              label={t('timeline.removeTrack')}
              onClick={() => setConfirmDeleteOpen(true)}
              icon={<Icon name="trash" size={13} />}
            />
          </div>
        </div>
        </div>
      </ContextMenu>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t('timeline.removeTrack')}
        description={t('timeline.removeTrackConfirm', { name: track.name })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => removeTrack(track.id)}
      />
    </>
  );
}
