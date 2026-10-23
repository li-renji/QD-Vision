/**
 * 左/右裁剪手柄（8px 命中区，hover 显示精确时间码）。
 */

import { useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { formatDuration } from '@clipcut/shared-types';
import { useClipResize } from '../../hooks/useClipResize.js';
import type { Asset, Clip } from '@clipcut/shared-types';

/** ClipTrimHandle 属性。 */
export interface ClipTrimHandleProps {
  clip: Clip;
  asset?: Asset;
  edge: 'in' | 'out';
  locked: boolean;
  /** 裁剪后的时长（毫秒），用于提示 */
  durationMs: number;
}

/**
 * 裁剪手柄。
 */
export function ClipTrimHandle({
  clip,
  asset,
  edge,
  locked,
  durationMs,
}: ClipTrimHandleProps): JSX.Element {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const { onPointerDown } = useClipResize({ clip, ...(asset ? { asset } : {}), locked });

  return (
    <div
      role="separator"
      aria-label={edge === 'in' ? 'trim in' : 'trim out'}
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className={`absolute top-0 z-10 h-full w-2 cursor-ew-resize ${
        edge === 'in' ? 'left-0' : 'right-0'
      } ${locked ? 'cursor-not-allowed' : ''}`}
    >
      <div
        className={`absolute top-0 h-full w-0.5 bg-white/0 transition-colors ${
          hover ? 'bg-[var(--cc-accent)]' : ''
        }`}
        style={edge === 'in' ? { left: 0 } : { right: 0 }}
      />
      {hover ? (
        <div
          className="absolute top-1 z-20 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] text-white"
          style={edge === 'in' ? { left: 10 } : { right: 10 }}
        >
          {formatDuration(durationMs)} ({t('timeline.zoom100')})
        </div>
      ) : null}
    </div>
  );
}
