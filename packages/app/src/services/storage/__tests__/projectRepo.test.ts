/**
 * 工程存储测试：列表排序、删除、Blob 缺失检测（fake-indexeddb）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getMissingBlobKeys, hasBlob, putBlob } from '../index.js';
import { deleteProject, listProjects, loadProject, saveProject } from '../projectRepo.js';
import { deserialize } from '../../../domain/project/deserialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';

describe('services/storage/projectRepo', () => {
  beforeEach(async () => {
    await closeDb();
  });

  it('保存后可以按 id 加载回工程', async () => {
    const { doc } = deserialize(readFixtureJson('minimal.clipcut.json'));
    await saveProject(doc);

    const loaded = await loadProject(doc.projectId);
    expect(loaded).not.toBeNull();
    expect(loaded?.projectId).toBe(doc.projectId);
    expect(loaded?.tracks.length).toBe(doc.tracks.length);
  });

  it('listProjects 严格按 updatedAt 倒序', async () => {
    const { doc: base } = deserialize(readFixtureJson('minimal.clipcut.json'));

    const older = { ...base, projectId: 'p-older', name: '较早', updatedAt: '2020-01-01T00:00:00.000Z' };
    const newer = { ...base, projectId: 'p-newer', name: '较新', updatedAt: '2030-01-01T00:00:00.000Z' };
    const middle = { ...base, projectId: 'p-middle', name: '中间', updatedAt: '2025-01-01T00:00:00.000Z' };

    await saveProject(older);
    await saveProject(newer);
    await saveProject(middle);

    const list = await listProjects();
    const ids = list.map((item) => item.projectId);
    expect(ids.indexOf('p-newer')).toBeLessThan(ids.indexOf('p-middle'));
    expect(ids.indexOf('p-middle')).toBeLessThan(ids.indexOf('p-older'));
  });

  it('删除工程会级联删除关联 blob', async () => {
    const { doc } = deserialize(readFixtureJson('minimal.clipcut.json'));
    await saveProject(doc);
    await putBlob('blob:asset_min01', new Blob(['x']));

    expect(await hasBlob('blob:asset_min01')).toBe(true);
    await deleteProject(doc.projectId);
    expect(await hasBlob('blob:asset_min01')).toBe(false);
    expect(await loadProject(doc.projectId)).toBeNull();
  });

  it('getMissingBlobKeys 找出缺失的素材（relink 核心）', async () => {
    await putBlob('blob:exists', new Blob(['x']));
    const missing = await getMissingBlobKeys(['blob:exists', 'blob:absent']);
    expect(missing).toEqual(['blob:absent']);
  });

  it('加载不存在的工程返回 null', async () => {
    expect(await loadProject('not-exist')).toBeNull();
  });
});
