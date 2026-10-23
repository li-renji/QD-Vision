/**
 * 按能力逐一选择 Provider + 填写 `baseUrl/model/apiKey`（掩码显示）+ 导入导出配置。
 */

import { useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { AI_CAPABILITIES, AI_CAPABILITY_LABELS, type AICapability } from '@clipcut/shared-types';
import { maskApiKey } from '@clipcut/ai-provider-sdk';
import { useProjectStore } from '../../state/projectStore.js';
import { setAiSettings } from '../../state/actions.js';
import { TextField } from '../common/TextField.js';
import { Select } from '../common/Select.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { toast } from '../common/Toast.js';

/**
 * AI Provider 设置页。
 */
export function ProviderSettingsTab(): JSX.Element {
  const { t } = useTranslation();
  const ai = useProjectStore((state) => state.doc.settings.ai);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const providerIds = Object.keys(ai.providers);
  const options = [
    { value: '', label: t('settings.providerNotConfigured') },
    ...providerIds.map((id) => ({ value: id, label: id })),
  ];

  return (
    <div className="flex flex-col gap-4 p-3">
      <p className="text-[11px] text-[var(--cc-fg-muted)]">{t('settings.apiKeyHint')}</p>

      {AI_CAPABILITIES.map((capability: AICapability) => (
        <section key={capability} className="rounded border border-[var(--cc-border)] p-2">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-xs font-medium text-[var(--cc-fg-primary)]">
              {AI_CAPABILITY_LABELS[capability]}
            </h4>
            <code className="text-[10px] text-[var(--cc-fg-muted)]">{capability}</code>
            <span className="ml-auto text-[10px] text-[var(--cc-fg-muted)]">
              {t('settings.notImplemented')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="cc-label w-20">{t('settings.provider')}</span>
            <Select
              value={ai.routes[capability] ?? ''}
              onValueChange={(value) =>
                setAiSettings({ routes: { [capability]: value === '' ? null : value } })
              }
              options={options}
              ariaLabel={t('settings.provider')}
            />
          </div>

          {ai.routes[capability]
            ? providerIds
                .filter((id) => id === ai.routes[capability])
                .map((id) => {
                  const provider = ai.providers[id];
                  if (!provider) return null;
                  const key = `${capability}:${id}`;
                  return (
                    <div key={key} className="mt-2 flex flex-col gap-2">
                      <TextField
                        label={t('settings.baseUrl')}
                        value={provider.baseUrl ?? ''}
                        onValueChange={(value) =>
                          setAiSettings({
                            providers: { [id]: { ...provider, baseUrl: value || null } },
                          })
                        }
                      />
                      <TextField
                        label={t('settings.model')}
                        value={provider.model ?? ''}
                        onValueChange={(value) =>
                          setAiSettings({
                            providers: { [id]: { ...provider, model: value || null } },
                          })
                        }
                      />
                      <div className="flex items-center gap-2">
                        <TextField
                          label={t('settings.apiKey')}
                          value={revealed[key] ? (provider.apiKey ?? '') : maskApiKey(provider.apiKey)}
                          onValueChange={(value) =>
                            setAiSettings({
                              providers: { [id]: { ...provider, apiKey: value || null } },
                            })
                          }
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={revealed[key] ? t('settings.apiKeyHide') : t('settings.apiKeyShow')}
                          title={revealed[key] ? t('settings.apiKeyHide') : t('settings.apiKeyShow')}
                          onClick={() => setRevealed((state) => ({ ...state, [key]: !state[key] }))}
                          icon={<Icon name={revealed[key] ? 'eye-off' : 'eye'} size={14} />}
                        />
                      </div>
                    </div>
                  );
                })
            : null}
        </section>
      ))}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const content = JSON.stringify(ai, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'clipcut-ai-config.json';
            anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast(t('settings.providerExport'), 'success');
          }}
        >
          {t('settings.providerExport')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json';
            input.addEventListener('change', () => {
              const file = input.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                try {
                  const parsed = JSON.parse(text) as {
                    providers?: Record<string, { type: 'local' | 'cloud' | 'webgpu'; baseUrl: string | null; model: string | null; apiKey: string | null }>;
                    routes?: Record<string, string | null>;
                  };
                  setAiSettings({
                    ...(parsed.providers ? { providers: parsed.providers } : {}),
                    ...(parsed.routes ? { routes: parsed.routes } : {}),
                  });
                  toast(t('settings.providerImport'), 'success');
                } catch {
                  toast(t('common.error'), 'error');
                }
              });
            });
            input.click();
          }}
        >
          {t('settings.providerImport')}
        </Button>
      </div>
    </div>
  );
}
