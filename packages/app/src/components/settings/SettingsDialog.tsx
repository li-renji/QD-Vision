/**
 * 设置对话框容器（通用 / AI / 导出 / 关于）。
 */

import { useState } from 'react';
import { useTranslation, type Language } from '../../i18n/index.js';
import { Dialog } from '../common/Dialog.js';
import { Tabs, TabPanel } from '../common/Tabs.js';
import { Select } from '../common/Select.js';
import { ProviderSettingsTab } from './ProviderSettingsTab.js';
import { CapabilitiesTab } from './CapabilitiesTab.js';
import { AboutTab } from './AboutTab.js';

/** SettingsDialog 属性。 */
export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 设置对话框。
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): JSX.Element {
  const { t, language, setLanguage } = useTranslation();
  const [tab, setTab] = useState('general');

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.title')}
      className="w-[min(640px,94vw)]"
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'general', label: t('settings.tab.general') },
          { value: 'ai', label: t('settings.tab.ai') },
          { value: 'capabilities', label: t('settings.tab.export') },
          { value: 'about', label: t('settings.tab.about') },
        ]}
      >
        <TabPanel value={tab}>
          {tab === 'general' ? (
          <div className="flex flex-col gap-2 p-1">
            <div className="flex items-center gap-2">
              <span className="cc-label w-20">{t('settings.language')}</span>
              <Select
                value={language}
                onValueChange={(value) => setLanguage(value as Language)}
                options={[
                  { value: 'zh-CN', label: '简体中文' },
                  { value: 'en-US', label: 'English' },
                ]}
                ariaLabel={t('settings.language')}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="cc-label w-20">{t('settings.theme')}</span>
              <span className="text-xs">{t('settings.theme.dark')}</span>
            </div>
          </div>
          ) : null}
          {tab === 'ai' ? <ProviderSettingsTab /> : null}
          {tab === 'capabilities' ? <CapabilitiesTab /> : null}
          {tab === 'about' ? <AboutTab /> : null}
        </TabPanel>
      </Tabs>
    </Dialog>
  );
}
