/**
 * 导出历史持久化（最近 10 条）。
 */

import { getDb, type ExportRecord } from './db.js';

/** 历史保留条数上限。 */
export const MAX_EXPORT_HISTORY = 10;

/** 写入一条导出历史，并裁剪到最近 10 条。 */
export async function addExportRecord(record: ExportRecord): Promise<void> {
  const db = await getDb();
  await db.put('exports', record);

  const all = await db.getAllFromIndex('exports', 'by-at');
  if (all.length > MAX_EXPORT_HISTORY) {
    const sorted = [...all].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const tx = db.transaction('exports', 'readwrite');
    for (const item of sorted.slice(MAX_EXPORT_HISTORY)) {
      await tx.store.delete(item.id);
    }
    await tx.done;
  }
}

/** 列出导出历史（按时间倒序）。 */
export async function listExportHistory(): Promise<ExportRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('exports', 'by-at');
  return [...all].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** 清空导出历史。 */
export async function clearExportHistory(): Promise<void> {
  const db = await getDb();
  await db.clear('exports');
}
