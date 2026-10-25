/**
 * clip 右键菜单内容（分割 / 变速 / 静音 / 画中画 / 删除）。
 *
 * 作为 Radix ContextMenu 的 `content` 使用，定位由 Radix 处理。
 */

import type { Clip } from '@clipcut/shared-types';
import { useTranslation } from '../../i18n/index.js';
import { ContextMenuItem, ContextMenuSeparator } from '../common/ContextMenu.js';
import { deleteClip, duplicateClip, setClipProperty, splitClip } from '../../state/actions.js';
import { useProjectStore } from '../../state/projectStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { toast } from '../common/Toast.js';

/** TimelineContextMenu 属性。 */
export interface TimelineContextMenuProps {
  /** 右键的 clip。 */
  clip: Clip;
}

/**
 * 时间线右键菜单。
 */
export function TimelineContextMenu({ clip }: TimelineContextMenuProps): JSX.Element {
  const { t } = useTranslation();
  const doc = useProjectStore((state) => state.doc);

  const run = (fn: () => { ok: boolean; error: string | null }): void => {
    const result = fn();
    if (!result.ok && result.error) toast(result.error, 'warning');
  };

  const track = doc.tracks.find((item) => item.clips.some((c) => c.id === clip.id));

  return (
    <>
      <ContextMenuItem
        label={t('timeline.split')}
        shortcut="S"
        onSelect={() => run(() => splitClip(clip.id, usePlaybackStore.getState().currentTimeMs))}
      />
      <ContextMenuItem
        label={t('timeline.duplicate')}
        onSelect={() => {
          if (!track) return;
          run(() => duplicateClip(clip.id, track.id, clip.startMs + clip.durationMs));
        }}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        label={clip.audio.muted ? t('timeline.unmute') : t('timeline.mute')}
        onSelect={() => run(() => setClipProperty(clip.id, 'audio.muted', !clip.audio.muted))}
      />
      <ContextMenuItem
        label={`${t('inspector.speed')} 0.5x`}
        onSelect={() => run(() => setClipProperty(clip.id, 'speed', 0.5))}
      />
      <ContextMenuItem
        label={`${t('inspector.speed')} 2x`}
        onSelect={() => run(() => setClipProperty(clip.id, 'speed', 2))}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        label={clip.isOverlay ? t('timeline.clearOverlay') : t('timeline.setOverlay')}
        onSelect={() => run(() => setClipProperty(clip.id, 'isOverlay', !clip.isOverlay))}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        label={t('timeline.delete')}
        shortcut="Del"
        onSelect={() => run(() => deleteClip(clip.id))}
      />
    </>
  );
}
