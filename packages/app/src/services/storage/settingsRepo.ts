/**
 * 全局设置持久化（语言、主题、Provider 配置、素材库 API Key）。
 *
 * 所有设置都只存于本机 IndexedDB，不会上传到任何服务器（FR-048①）。
 */

import { getDb } from './db.js';

/** 设置键名。 */
export const SettingKeys = {
  language: 'app.language',
  theme: 'app.theme',
  providers: 'ai.providers',
  routes: 'ai.routes',
  pixabayApiKey: 'library.pixabayApiKey',
  freesoundApiKey: 'library.freesoundApiKey',
  mcpConfig: 'mcp.config',
  lastOpenedProjectId: 'app.lastOpenedProjectId',
} as const;

/** 读取一个设置。 */
export async function getSetting<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const record = await db.get('settings', key);
  if (!record) return null;
  return (record.value as T) ?? null;
}

/** 写入一个设置。 */
export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('settings', { key, value, updatedAt: new Date().toISOString() });
}

/** 删除一个设置。 */
export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('settings', key);
}

/** 读取全部设置（键 → 值）。 */
export async function getAllSettings(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const records = await db.getAll('settings');
  const out: Record<string, unknown> = {};
  for (const record of records) {
    out[record.key] = record.value;
  }
  return out;
}
