/**
 * 单个 clip 视图（性能核心）。
 *
 * - 位置用 `transform: translateX()`（GPU 友好），宽度 = `durationMs * pxPerSecond`；
 * - `React.memo` + 细粒度选择器订阅（只订阅自己的 clip）；
 * - PIP clip 显示特殊描边。
 */

import { memo } from 'react';
import type { Asset, Clip } from '@clipcut/shared-types';
import { useUiStore } from '../../state/uiStore.js';
import { useClipDrag } from '../../hooks/useClipDrag.js';
import { ContextMenu } from '../common/ContextMenu.js';
import { ClipTrimHandle } from './ClipTrimHandle.js';
import { WaveformCanvas } from './WaveformCanvas.js';
import { TimelineContextMenu } from './TimelineContextMenu.js';
import { clsx } from '../../utils/clsx.js';

/** ClipView 属性。 */
export interface ClipViewProps {
  clip: Clip;
  asset?: Asset;
  trackId: string;
  trackLocked: boolean;
  selected: boolean;
  onSelect: (clipId: string, additive: boolean) => void;
}

/**
 * clip 视图。
 */
export const ClipView = memo(function ClipView({
  clip,
  asset,
  trackId,
  trackLocked,
  selected,
  onSelect,
}: ClipViewProps): JSX.Element {
  const pxPerSecond = useUiStore((state) => state.pxPerSecond);
  const drag = useClipDrag({ clip, trackId, locked: trackLocked });

  const widthPx = (clip.durationMs / 1000) * pxPerSecond;
  const isText = clip.assetId === null;

  return (
    <ContextMenu content={<TimelineContextMenu clip={clip} />}>
      <div
        className={clsx(
          'absolute top-1 bottom-1 overflow-hidden rounded border',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-white',
          isText
            ? 'border-[var(--cc-bg-clip-text)] bg-[var(--cc-bg-clip-text)]'
            : 'border-[var(--cc-bg-clip)] bg-[var(--cc-bg-clip)]',
          selected ? 'ring-2 ring-[var(--cc-accent)]' : '',
          clip.isOverlay ? 'border-dashed border-[var(--cc-warning)]' : '',
          trackLocked ? 'opacity-60' : '',
        )}
        style={{ width: `${Math.max(2, widthPx)}px` }}
        onPointerDown={(event) => {
          if (event.button === 2) return;
          onSelect(clip.id, event.shiftKey || event.ctrlKey || event.metaKey);
        }}
        onPointerDownCapture={trackLocked ? undefined : drag.onPointerDown}
        role="button"
        tabIndex={0}
        aria-label={clip.label ?? clip.id}
        title={clip.label ?? undefined}
      >
        {asset?.type === 'audio' && asset.waveform ? (
          <WaveformCanvas asset={asset} widthPx={widthPx} heightPx={32} />
        ) : null}

        {isText && clip.text ? (
          <div className="pointer-events-none truncate px-1.5 pt-1 text-[11px] text-white/90">
            {clip.text.content || '—'}
          </div>
        ) : null}

        {widthPx > 60 && !isText ? (
          <div className="pointer-events-none truncate px-1.5 pt-1 text-[10px] text-white/80">
            {clip.label ?? asset?.name ?? ''}
          </div>
        ) : null}

        {clip.isOverlay ? (
          <span className="pointer-events-none absolute right-1 top-0.5 rounded bg-black/50 px-1 text-[9px] text-[var(--cc-warning)]">
            PIP
          </span>
        ) : null}

        {!trackLocked ? (
          <>
            <ClipTrimHandle
              clip={clip}
              {...(asset ? { asset } : {})}
              edge="in"
              locked={trackLocked}
              durationMs={clip.inMs}
            />
            <ClipTrimHandle
              clip={clip}
              {...(asset ? { asset } : {})}
              edge="out"
              locked={trackLocked}
              durationMs={clip.outMs - clip.inMs}
            />
          </>
        ) : null}
      </div>
    </ContextMenu>
  );
});
