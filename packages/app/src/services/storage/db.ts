/**
 * IndexedDB 打开与建表。
 *
 * 四张表：
 * - `projects`：工程结构化数据，keyPath `projectId`，索引 `updatedAt`
 * - `blobs`：二进制素材，keyPath `key`
 * - `exports`：导出历史，keyPath `id`，索引 `at`
 * - `settings`：全局设置，keyPath `key`
 *
 * 说明：素材二进制**只能**存在这里，绝不允许进入 localStorage（FR-002③）。
 *
 * 本文件是全项目**唯一**允许直接访问 `indexedDB` 的位置（ESLint 白名单）。
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProjectDoc } from '@clipcut/shared-types';

/** 数据库名称。 */
export const DB_NAME = 'clipcut-db';

/** 数据库版本。 */
export const DB_VERSION = 1;

/** blob 主键命名规则。 */
export const BlobKeys = {
  asset: (assetId: string): string => `blob:${assetId}`,
  thumbnail: (assetId: string): string => `thumb:${assetId}`,
  proxy: (assetId: string): string => `proxy:${assetId}`,
  export: (jobId: string): string => `export:${jobId}`,
} as const;

/** `projects` 表中存储的记录。 */
export interface ProjectRecord {
  projectId: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  durationMs: number;
  /** 序列化的工程 JSON 字符串 */
  payload: string;
}

/** `exports` 表中存储的记录。 */
export interface ExportRecord {
  id: string;
  at: string;
  format: string;
  durationMs: number;
  sizeBytes: number;
  blobKey: string;
  width: number;
  height: number;
  fps: number;
}

/** `settings` 表中存储的记录。 */
export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

/** IndexedDB Schema 定义。 */
interface ClipCutDB extends DBSchema {
  projects: {
    key: string;
    value: ProjectRecord;
    indexes: { 'by-updatedAt': string };
  };
  blobs: {
    key: string;
    value: Blob;
  };
  exports: {
    key: string;
    value: ExportRecord;
    indexes: { 'by-at': string };
  };
  settings: {
    key: string;
    value: SettingRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<ClipCutDB>> | null = null;

/** 打开（并在首次时创建）数据库。 */
export function getDb(): Promise<IDBPDatabase<ClipCutDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ClipCutDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const store = db.createObjectStore('projects', { keyPath: 'projectId' });
          store.createIndex('by-updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs');
        }
        if (!db.objectStoreNames.contains('exports')) {
          const store = db.createObjectStore('exports', { keyPath: 'id' });
          store.createIndex('by-at', 'at');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
      blocked() {
        // `[clipcut]` 是日志前缀，与 `clipcut:` 存储键前缀成对出现，保持不变（改了会和既有日志约定脱节）。
        console.warn('[clipcut] IndexedDB 升级被其它标签页阻塞，请关闭其它 QD视界 标签页。');
      },
    });
  }
  return dbPromise;
}

/** 关闭数据库连接（测试与「重置数据库」功能使用）。 */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

/** 把工程转换为 `projects` 表的记录。 */
export function toProjectRecord(doc: ProjectDoc, payload: string): ProjectRecord {
  return {
    projectId: doc.projectId,
    name: doc.name,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    durationMs: doc.meta.durationMs,
    payload,
  };
}
