/**
 * 轨道右键菜单（轨道头 / 轨道行空白处唤出）。
 *
 * 覆盖轨道级操作：重命名 / 静音 / 隐藏 / 锁定 / 上下移动 / 新增轨道 / 删除轨道。
 * 破坏性操作（删除轨道）不在这里直接执行，而是通过 `onRequestDelete`
 * 上交父组件弹二次确认——Radix ContextMenu 关闭时会卸载内容，
 * 确认对话框必须活在菜单之外（见 `TrackHeader`）。
 */

import type { Track } from '@clipcut/shared-types';
import { useTranslation } from '../../i18n/index.js';
import { useProjectStore } from '../../state/projectStore.js';
import { addTrack, extractAudio, reorderTrack, setTrackFlags } from '../../state/actions.js';
import { toast } from '../common/Toast.js';
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from '../common/ContextMenu.js';

/** TrackContextMenu 属性。 */
export interface TrackContextMenuProps {
  /** 右键的轨道。 */
  track: Track;
  /** 请求进入重命名编辑（由父组件切到行内输入框）。 */
  onRequestRename: () => void;
  /** 请求删除轨道（由父组件弹二次确认）。 */
  onRequestDelete: () => void;
}

/**
 * 轨道右键菜单内容。
 */
export function TrackContextMenu({
  track,
  onRequestRename,
  onRequestDelete,
}: TrackContextMenuProps): JSX.Element {
  const { t } = useTranslation();
  const tracks = useProjectStore((state) => state.doc.tracks);
  const maxOrder = tracks.reduce((max, item) => Math.max(max, item.order), 0);
  const canMoveUp = track.order > 0;
  const canMoveDown = track.order < maxOrder;

  const run = (fn: () => { ok: boolean; error: string | null }): void => {
    const result = fn();
    if (!result.ok && result.error) toast(result.error, 'warning');
  };

  const handleExtractAudio = (): void => {
    const result = extractAudio(track.id);
    if (!result.ok && result.error) {
      toast(result.error, 'warning');
      return;
    }
    toast(t('timeline.extractAudioDone', { count: result.value ?? 0 }), 'success');
  };

  const addTrackOfType = (type: Track['type']): void => {
    const count = tracks.filter((item) => item.type === type).length;
    run(() =>
      addTrack({
        type,
        name: `${t(`timeline.addTrack.${type}`)} ${count + 1}`,
      }),
    );
  };

  return (
    <>
      <ContextMenuItem label={t('timeline.renameTrack')} onSelect={onRequestRename} />
      {track.type === 'video' ? (
        <ContextMenuItem label={t('timeline.extractAudio')} onSelect={handleExtractAudio} />
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem
        label={track.muted ? t('timeline.unmute') : t('timeline.mute')}
        onSelect={() => run(() => setTrackFlags(track.id, { muted: !track.muted }))}
      />
      {track.type === 'video' ? (
        <ContextMenuItem
          label={track.hidden ? t('timeline.show') : t('timeline.hide')}
          onSelect={() => run(() => setTrackFlags(track.id, { hidden: !track.hidden }))}
        />
      ) : null}
      <ContextMenuItem
        label={track.locked ? t('timeline.unlock') : t('timeline.lock')}
        onSelect={() => run(() => setTrackFlags(track.id, { locked: !track.locked }))}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        label={t('timeline.moveUp')}
        disabled={!canMoveUp}
        onSelect={() => run(() => reorderTrack(track.id, 'up'))}
      />
      <ContextMenuItem
        label={t('timeline.moveDown')}
        disabled={!canMoveDown}
        onSelect={() => run(() => reorderTrack(track.id, 'down'))}
      />
      <ContextMenuSeparator />
      <ContextMenuLabel>{t('timeline.addTrack')}</ContextMenuLabel>
      <ContextMenuItem label={t('timeline.addTrack.video')} onSelect={() => addTrackOfType('video')} />
      <ContextMenuItem label={t('timeline.addTrack.audio')} onSelect={() => addTrackOfType('audio')} />
      <ContextMenuItem label={t('timeline.addTrack.text')} onSelect={() => addTrackOfType('text')} />
      <ContextMenuItem
        label={t('timeline.addTrack.subtitle')}
        onSelect={() => addTrackOfType('subtitle')}
      />
      <ContextMenuSeparator />
      <ContextMenuItem label={t('timeline.removeTrack')} onSelect={onRequestDelete} />
    </>
  );
}
