/**
 * 全屏拖拽遮罩。
 */

import { clsx } from '../../utils/clsx.js';

/** FileDropOverlay 属性。 */
export interface FileDropOverlayProps {
  /** 是否显示 */
  visible: boolean;
  /** 提示文案 */
  hint: string;
}

/** 拖拽遮罩。 */
export function FileDropOverlay({ visible, hint }: FileDropOverlayProps): JSX.Element | null {
  if (!visible) return null;

  return (
    <div
      className={clsx(
        'pointer-events-none fixed inset-0 z-[70] flex items-center justify-center',
        'border-4 border-dashed border-[var(--cc-accent)] bg-black/60',
      )}
    >
      <div className="rounded-lg bg-[var(--cc-bg-panel)] px-6 py-4 text-sm text-[var(--cc-fg-primary)] shadow-2xl">
        {hint}
      </div>
    </div>
  );
}
