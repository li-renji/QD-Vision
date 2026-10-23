/**
 * 自研轻量 i18n（FR-058）。
 *
 * - 约 80 行，无第三方依赖、无 Provider 嵌套、无 Suspense。
 * - 语言切换持久化到 `settingsRepo`（IndexedDB）。
 * - 未来接入正式 i18n 框架（FR-062 / P2）时整体替换本目录即可。
 */

import { useCallback, useEffect, useState } from 'react';
import { enUS } from './locales/en-US.js';
import { zhCN } from './locales/zh-CN.js';
import { getPlatformBridge } from '../platform/index.js';

/** 支持的语言。 */
export type Language = 'zh-CN' | 'en-US';

/** 字典。 */
export type Dictionary = Record<string, string>;

/** 全部字典。 */
const DICTIONARIES: Record<Language, Dictionary> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/** 变量插值值。 */
export type TranslationVars = Record<string, string | number>;

/** 当前语言。 */
let currentLanguage: Language = 'zh-CN';

/** 订阅者集合。 */
const listeners = new Set<(language: Language) => void>();

/**
 * 初始化 i18n。
 *
 * @param language 初始语言（缺省按浏览器语言推断；持久化的语言由 `loadPersistedLanguage()` 读取）
 */
export function initI18n(language?: Language): Language {
  if (language) {
    currentLanguage = language;
  } else {
    const navigatorLanguage = typeof navigator === 'undefined' ? 'zh-CN' : navigator.language;
    currentLanguage = navigatorLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  }
  notify();
  return currentLanguage;
}

/** 持久化语言的键名（由 PlatformBridge 统一加 `clipcut:` 前缀）。 */
const LANGUAGE_STORAGE_KEY = 'app.language';

/**
 * 持久化语言。
 *
 * 走 `PlatformBridge.storage()`（业务层唯一允许的键值存储出口）。
 */
function persistLanguage(language: Language): void {
  void getPlatformBridge()
    .storage(LANGUAGE_STORAGE_KEY, language)
    .catch(() => {
      // 存储不可用时忽略（不影响使用）
    });
}

/**
 * 读取持久化的语言（异步）。
 */
export async function loadPersistedLanguage(): Promise<Language | null> {
  try {
    const stored = await getPlatformBridge().storage<Language>(LANGUAGE_STORAGE_KEY, null);
    return stored === 'zh-CN' || stored === 'en-US' ? stored : null;
  } catch {
    return null;
  }
}

/** 通知订阅者。 */
function notify(): void {
  for (const listener of listeners) listener(currentLanguage);
}

/** 取得当前语言。 */
export function getLanguage(): Language {
  return currentLanguage;
}

/** 切换语言。 */
export function setLanguage(language: Language): void {
  if (currentLanguage === language) return;
  currentLanguage = language;
  persistLanguage(language);
  notify();
}

/**
 * 翻译。
 *
 * @param key 文案键
 * @param vars 插值变量
 * @returns 翻译结果；键不存在时返回键本身（便于发现缺失）
 */
export function t(key: string, vars?: TranslationVars): string {
  const dictionary = DICTIONARIES[currentLanguage] ?? zhCN;
  const template = dictionary[key] ?? zhCN[key] ?? key;
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** 订阅语言变化。 */
export function onLanguageChange(listener: (language: Language) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React Hook：取得翻译函数与当前语言。
 */
export function useTranslation(): {
  t: (key: string, vars?: TranslationVars) => string;
  language: Language;
  setLanguage: (language: Language) => void;
} {
  const [language, setLanguageState] = useState<Language>(currentLanguage);

  useEffect(() => {
    return onLanguageChange((next) => {
      setLanguageState(next);
    });
  }, []);

  const translate = useCallback((key: string, vars?: TranslationVars) => t(key, vars), []);
  const changeLanguage = useCallback((next: Language) => setLanguage(next), []);

  return { t: translate, language, setLanguage: changeLanguage };
}

/** 字典键集合（用于一致性测试）。 */
export function getDictionaryKeys(language: Language): string[] {
  return Object.keys(DICTIONARIES[language] ?? {}).sort();
}
