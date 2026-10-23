/**
 * 关于、版本、许可证、浏览器兼容提示。
 */

import { useTranslation } from '../../i18n/index.js';
import { APP_ID, CURRENT_SCHEMA_VERSION } from '@clipcut/shared-types';

/**
 * 关于页。
 */
export function AboutTab(): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 p-3 text-[11px] leading-relaxed text-[var(--cc-fg-secondary)]">
      <div>
        <h4 className="text-sm font-semibold text-[var(--cc-fg-primary)]">{t('app.name')}</h4>
        <p className="mt-0.5">{t('app.tagline')}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="cc-label">{t('settings.version')}</dt>
        <dd className="tabular-nums">v{CURRENT_SCHEMA_VERSION}</dd>
        <dt className="cc-label">{t('about.identifier')}</dt>
        <dd className="font-mono">{APP_ID}</dd>
        <dt className="cc-label">{t('settings.license')}</dt>
        <dd>MIT</dd>
      </dl>

      <p>{t('about.localOnly')}</p>
    </div>
  );
}