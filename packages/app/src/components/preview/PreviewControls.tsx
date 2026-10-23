/**
 * 播放 / 暂停 / 上一帧 / 下一帧 / 首 / 尾 / J K L 控件。
 */

import { useTranslation } from '../../i18n/index.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { useProjectStore } from '../../state/projectStore.js';
import { IconButton } from '../common/IconButton.js';
import { Icon } from '../common/Icon.js';
import { Select } from '../common/Select.js';
import { SHUTTLE_RATES } from '../../hooks/useHotkeys.js';

/**
 * 传输控制。
 */
export function PreviewControls(): JSX.Element {
  const { t } = useTranslation();
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const playbackRate = usePlaybackStore((state) => state.playbackRate);
  const setPlaybackRate = usePlaybackStore((state) => state.setPlaybackRate);
  const durationMs = useProjectStore((state) => state.doc.meta.durationMs);

  return (
    <div className="flex h-10 shrink-0 items-center justify-center gap-1 border-t border-[var(--cc-border)] bg-[var(--cc-bg-panel)]">
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
        label={isPlaying ? t('toolbar.pause') : t('toolbar.play')}
        active={isPlaying}
        onClick={() => usePlaybackStore.getState().togglePlay()}
        icon={<Icon name={isPlaying ? 'pause' : 'play'} size={14} />}
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

      <div className="mx-2 h-4 w-px shrink-0 bg-[var(--cc-border)]" />

      <Select
        value={String(playbackRate)}
        onValueChange={(value) => setPlaybackRate(Number(value))}
        options={SHUTTLE_RATES.map((rate) => ({
          value: String(rate),
          label: t('preview.speed', { value: rate }),
        }))}
        ariaLabel={t('preview.speed', { value: playbackRate })}
      />
    </div>
  );
}
