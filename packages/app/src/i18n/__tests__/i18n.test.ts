/**
 * i18n 一致性测试：zh-CN 与 en-US 的键集合必须完全一致。
 */

import { describe, expect, it } from 'vitest';
import { getDictionaryKeys, initI18n, setLanguage, t } from '../index.js';

describe('i18n', () => {
  it('中英文键集合完全一致', () => {
    const zh = getDictionaryKeys('zh-CN');
    const en = getDictionaryKeys('en-US');
    expect(zh).toEqual(en);
    expect(zh.length).toBeGreaterThan(100);
  });

  it('没有 key 缺失回退到 key 本身', () => {
    for (const key of getDictionaryKeys('zh-CN')) {
      setLanguage('zh-CN');
      expect(t(key), `zh 缺失 ${key}`).not.toBe(key);
      setLanguage('en-US');
      expect(t(key), `en 缺失 ${key}`).not.toBe(key);
    }
  });

  it('变量插值生效', () => {
    setLanguage('zh-CN');
    expect(t('status.selection', { count: 3 })).toContain('3');
    expect(t('unknown.key')).toBe('unknown.key');
  });

  it('语言切换后文案整体切换', () => {
    initI18n('zh-CN');
    const zh = t('toolbar.play');
    initI18n('en-US');
    const en = t('toolbar.play');
    expect(zh).not.toBe(en);
    expect(en).toBe('Play');
  });
});
