/**
 * 编辑器与设置面板之间的 Tab 容器。
 */

import { useState, type ReactNode } from 'react';
import { Tabs } from '../common/Tabs.js';
import { useTranslation } from '../../i18n/index.js';

/** WorkspaceTabs 属性。 */
export interface WorkspaceTabsProps {
  /** 编辑器工作区内容。 */
  editor: ReactNode;
  /** 设置面板内容。 */
  settings: ReactNode;
}

/**
 * 工作区 Tab 容器。
 */
export function WorkspaceTabs({ editor, settings }: WorkspaceTabsProps): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState('editor');

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      items={[
        { value: 'editor', label: t('app.name') },
        { value: 'settings', label: t('settings.title') },
      ]}
    >
      <div className="flex h-full flex-col overflow-hidden">{tab === 'editor' ? editor : settings}</div>
    </Tabs>
  );
}
