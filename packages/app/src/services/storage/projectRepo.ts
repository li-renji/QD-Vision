/**
 * 工程 CRUD（IndexedDB `projects` 表）。
 */

import type { ProjectDoc } from '@clipcut/shared-types';
import { getDb, toProjectRecord } from './db.js';
import { BlobKeys } from './db.js';
import { deleteBlobs } from './blobRepo.js';
import { serialize } from '../../domain/project/serialize.js';
import { deserialize } from '../../domain/project/deserialize.js';

/** 工程列表项（不含完整 payload）。 */
export interface ProjectListItem {
  projectId: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  durationMs: number;
}

/**
 * 列出全部工程，**按 `updatedAt` 倒序**。
 */
export async function listProjects(): Promise<ProjectListItem[]> {
  const db = await getDb();
  const records = await db.getAllFromIndex('projects', 'by-updatedAt');
  return records
    .map((record) => ({
      projectId: record.projectId,
      name: record.name,
      updatedAt: record.updatedAt,
      createdAt: record.createdAt,
      durationMs: record.durationMs,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/**
 * 保存工程。
 *
 * 只更新 `updatedAt`，**不改变 `schemaVersion`**（FR-005②）。
 */
export async function saveProject(doc: ProjectDoc): Promise<void> {
  const db = await getDb();
  const payload = serialize(doc);
  await db.put('projects', toProjectRecord(doc, payload));
}

/**
 * 加载工程；不存在或解析失败时返回 null。
 */
export async function loadProject(projectId: string): Promise<ProjectDoc | null> {
  const db = await getDb();
  const record = await db.get('projects', projectId);
  if (!record) return null;
  try {
    return deserialize(JSON.parse(record.payload) as unknown);
  } catch {
    return null;
  }
}

/**
 * 删除工程，并级联删除其关联 blob。
 */
export async function deleteProject(projectId: string): Promise<void> {
  const db = await getDb();
  const record = await db.get('projects', projectId);
  await db.delete('projects', projectId);
  if (!record) return;

  // 级联删除：素材主 blob、缩略图与代理文件。
  const keys: string[] = [];
  try {
    const doc = deserialize(JSON.parse(record.payload) as unknown);
    for (const asset of Object.values(doc.assets)) {
      if (asset.blobKey) keys.push(asset.blobKey);
      if (asset.thumbnailBlobKey) keys.push(asset.thumbnailBlobKey);
      if (asset.proxyBlobKey) keys.push(asset.proxyBlobKey);
    }
    if (doc.meta.lastExport?.blobKey) keys.push(doc.meta.lastExport.blobKey);
  } catch {
    // 记录损坏时至少尝试删除主 blob。
    keys.push(BlobKeys.asset(projectId));
  }
  await deleteBlobs(keys);
}

/** 判断工程是否存在。 */
export async function projectExists(projectId: string): Promise<boolean> {
  const db = await getDb();
  return (await db.count('projects', projectId)) > 0;
}
