/**
 * 轨道头：名称 / 静音 / 隐藏 / 锁定 / 高度，粘性固定不随横向滚动。
 */

import { useTranslation } from '../../i18n/index.js';
import type { Track } from '@clipcut/shared-types';
import { IconButton } from '../common/IconButton.js';
import { setTrackFlags } from '../../state/actions.js';

/** TrackHeader 属性。 */
export interface TrackHeaderProps {
  track: Track;
  selected: boolean;
  onSelect: (trackId: string) => void;
}

/**
 * 轨道头。
 */
export function TrackHeader({ track, selected, onSelect }: TrackHeaderProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <div
      className={`flex h-full w-trackhead shrink-0 flex-col justify-center gap-0.5 border-b border-[var(--cc-border)] px-2 ${
        selected ? 'bg-[var(--cc-bg-elevated)]' : 'bg-[var(--cc-bg-panel)]'
      }`}
      onClick={() => onSelect(track.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(track.id);
      }}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--cc-fg-primary)]" title={track.name}>
          {track.name}
        </span>
        <IconButton
          size="sm"
          label={track.muted ? t('timeline.unmute') : t('timeline.mute')}
          active={track.muted}
          onClick={() => setTrackFlags(track.id, { muted: !track.muted })}
          icon={<span>{track.muted ? '🔇' : '🔊'}</span>}
        />
        {track.type === 'video' ? (
          <IconButton
            size="sm"
            label={track.hidden ? t('timeline.show') : t('timeline.hide')}
            active={track.hidden}
            onClick={() => setTrackFlags(track.id, { hidden: !track.hidden })}
            icon={<span>{track.hidden ? '🙈' : '👁'}</span>}
          />
        ) : null}
        <IconButton
          size="sm"
          label={track.locked ? t('timeline.unlock') : t('timeline.lock')}
          active={track.locked}
          onClick={() => setTrackFlags(track.id, { locked: !track.locked })}
          icon={<span>{track.locked ? '🔒' : '🔓'}</span>}
        />
      </div>
      <div className="cc-label">
        {track.type === 'video' ? 'V' : track.type === 'audio' ? 'A' : 'T'} · {track.clips.length}
      </div>
    </div>
  );
}
