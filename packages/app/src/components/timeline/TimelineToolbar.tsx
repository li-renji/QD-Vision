/**
 * 时间线工具栏：分割 / 删除 / 复制 / 吸附开关 / 缩放控件 / 轨道管理。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { useUiStore } from '../../state/uiStore.js';
import { useProjectStore } from '../../state/projectStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import {
  addTrack,
  copySelectedClips,
  deleteSelectedClips,
  pasteClips,
  splitSelectedClip,
} from '../../state/actions.js';
import { toast } from '../common/Toast.js';
import { Button } from '../common/Button.js';
import { IconButton } from '../common/IconButton.js';
import { Icon } from '../common/Icon.js';
import { Select } from '../common/Select.js';
import { Tooltip } from '../common/Tooltip.js';
import { MAX_PX_PER_SECOND, MIN_PX_PER_SECOND } from '../../state/uiStore.js';
import {
  evaluateSplitAtTime,
  MIN_CLIP_DURATION_MS,
  type SplitDangerZone,
} from '../../domain/timeline/index.js';

/**
 * 时间线工具栏。
 */
export function TimelineToolbar(): JSX.Element {
  const { t } = useTranslation();
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const setPxPerSecond = useUiStore((state) => state.setPxPerSecond);
  const selectedClipIds = useUiStore((state) => state.selectedClipIds);
  const tracks = useProjectStore((state) => state.doc.tracks);
  const doc = useProjectStore((state) => state.doc);
  const fps = useProjectStore((state) => state.doc.settings.canvas.fps);
  // 以 ~10Hz 节流订阅播放头时间：避免 60Hz 重渲染整个工具栏。
  const [currentTimeMs, setCurrentTimeMs] = useState(() => usePlaybackStore.getState().currentTimeMs);
  useEffect(() => {
    let last = 0;
    return usePlaybackStore.subscribe((state) => {
      const now = performance.now();
      if (now - last >= 100) {
        last = now;
        setCurrentTimeMs(state.currentTimeMs);
      }
    });
  }, []);

  const report = (result: { ok: boolean; error: string | null }): void => {
    if (!result.ok && result.error) toast(result.error, 'warning');
  };

  // 分割危险区：播放头落在选中 clip 的首/尾危险区时**前置禁用**分割按钮（FR-018③）
  const frameMs = 1000 / Math.max(1, fps);
  const danger: SplitDangerZone | null =
    selectedClipIds.length > 0
      ? evaluateSplitAtTime(doc, currentTimeMs, frameMs, MIN_CLIP_DURATION_MS)
      : null;
  const splitBlocked = selectedClipIds.length === 0 || (danger?.blocked ?? false);

  /** 组装「含可执行替代动作」的分割拒绝文案（走 i18n，领域层不依赖 i18n）。 */
  const splitBlockedMessage = (zone: SplitDangerZone | null): string => {
    if (!zone) return t('timeline.tooShort', { left: 0, right: 0, min: MIN_CLIP_DURATION_MS, action: '' });
    const action =
      zone.action === 'move-left'
        ? t('timeline.tooShort.actionLeft', { min: zone.minMs })
        : t('timeline.tooShort.actionRight', { min: zone.minMs });
    return t('timeline.tooShort', {
      left: zone.leftMs,
      right: zone.rightMs,
      min: zone.minMs,
      action,
    });
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--cc-border)] px-2">
      <Tooltip content={splitBlocked ? splitBlockedMessage(danger) : t('timeline.split')}>
        <span className="inline-flex">
          <Button
            size="sm"
            variant="ghost"
            disabled={splitBlocked}
            onClick={() => report(splitSelectedClip())}
            icon={<Icon name="scissors" size={13} />}
          >
            {t('timeline.split')}
          </Button>
        </span>
      </Tooltip>
      <Button
        size="sm"
        variant="ghost"
        disabled={selectedClipIds.length === 0}
        onClick={() => report(deleteSelectedClips())}
        icon={<Icon name="trash" size={13} />}
      >
        {t('timeline.delete')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={selectedClipIds.length === 0}
        onClick={() => report(copySelectedClips())}
        icon={<Icon name="copy" size={13} />}
      >
        {t('timeline.copy')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => report(pasteClips())}
        icon={<Icon name="clipboard" size={13} />}
      >
        {t('timeline.paste')}
      </Button>

      <div className="mx-1 h-4 w-px shrink-0 bg-[var(--cc-border)]" />

      <div className="mx-1 h-4 w-px shrink-0 bg-[var(--cc-border)]" />

      <IconButton
        label={t('timeline.zoomOut')}
        onClick={() => setPxPerSecond(pxPerSecond / 1.4)}
        icon={<Icon name="minus" size={14} />}
      />
      <span className="w-16 shrink-0 text-center font-mono text-[11px] tabular-nums text-[var(--cc-fg-muted)]">
        {pxPerSecond.toFixed(0)}px/s
      </span>
      <IconButton
        label={t('timeline.zoomIn')}
        onClick={() => setPxPerSecond(pxPerSecond * 1.4)}
        icon={<Icon name="plus" size={14} />}
      />
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setPxPerSecond(MIN_PX_PER_SECOND)}
        title={`${MIN_PX_PER_SECOND} ~ ${MAX_PX_PER_SECOND} px/s`}
      >
        {t('timeline.zoomFit')}
      </Button>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Select
          value=""
          onValueChange={(value) => {
            if (value === 'video' || value === 'audio' || value === 'text' || value === 'subtitle') {
              const count = tracks.filter((track) => track.type === value).length;
              report(
                addTrack({
                  type: value,
                  name: `${t(`timeline.addTrack.${value}`)} ${count + 1}`,
                }),
              );
            }
          }}
          options={[
            { value: '', label: t('timeline.addTrack') },
            { value: 'video', label: t('timeline.addTrack.video') },
            { value: 'audio', label: t('timeline.addTrack.audio') },
            { value: 'text', label: t('timeline.addTrack.text') },
            { value: 'subtitle', label: t('timeline.addTrack.subtitle') },
          ]}
          ariaLabel={t('timeline.addTrack')}
        />
      </div>
    </div>
  );
}
