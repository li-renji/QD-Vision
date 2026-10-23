/**
 * 播放 / 暂停 / 上一帧 / 下一帧 / 首 / 尾 / J K L 控件。
 */

import { useTranslation } from '../../i18n/index.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { useProjectStore } from '../../state/projectStore.js';
import { unlockPreviewAudio } from '../../services/media/previewAudio.js';
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

  /**
   * 空工程（时间线上没有任何内容）时禁用播放。
   *
   * 剪辑软件惯例（剪映 / Premiere）：空工程播放按钮置灰。
   * 这样用户新建工程后点播放不会「按了没反应」，也不会误以为功能坏了。
   *
   * 注意：底层时钟在空工程下**依然能正常推进**（见 playbackClock 的空工程用例），
   * 这里只是 UI 层不给入口，两者不互相依赖。
   */
  const isTimelineEmpty = durationMs <= 0;
  const playLabel = isTimelineEmpty
    ? t('preview.emptyTimeline')
    : isPlaying
      ? t('toolbar.pause')
      : t('toolbar.play');

  /**
   * 播放 / 暂停。
   *
   * ⚠️ `unlockPreviewAudio()` 必须**同步**写在 `onClick` 里（此刻仍在用户手势
   * 调用栈内）：浏览器自动播放策略只认手势上下文，`AudioContext` 在手势之外
   * `resume()` 会被拒绝 —— 表现正是「点了播放，画面在动，就是没声音」。
   *
   * 顺序也有讲究：先解锁再切播放状态，保证 `video.play()` 发生时
   * AudioContext 已是 running。
   */
  const handleTogglePlay = (): void => {
    if (!usePlaybackStore.getState().isPlaying) {
      void unlockPreviewAudio();
    }
    usePlaybackStore.getState().togglePlay();
  };

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
        label={playLabel}
        active={isPlaying}
        disabled={isTimelineEmpty}
        onClick={handleTogglePlay}
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
