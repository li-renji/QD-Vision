/**
 * 拖拽导入遮罩与提示。
 */

import { useTranslation } from '../../i18n/index.js';
import { FileDropOverlay } from '../common/FileDropOverlay.js';

/** MediaDropZone 属性。 */
export interface MediaDropZoneProps {
  /** 是否正在拖拽到面板上。 */
  active: boolean;
}

/**
 * 素材面板的拖拽提示层。
 */
export function MediaDropZone({ active }: MediaDropZoneProps): JSX.Element {
  const { t } = useTranslation();
  return <FileDropOverlay visible={active} hint={t('media.dropHint')} />;
}
