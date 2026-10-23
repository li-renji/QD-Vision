/**
 * 存储层导出。
 */

export {
  BlobKeys,
  DB_NAME,
  DB_VERSION,
  closeDb,
  getDb,
  toProjectRecord,
  type ExportRecord,
  type ProjectRecord,
  type SettingRecord,
} from './db.js';
export {
  deleteBlob,
  deleteBlobs,
  estimateUsage,
  getBlobByKey,
  getMissingBlobKeys,
  hasBlob,
  listBlobKeys,
  putBlob,
} from './blobRepo.js';
export {
  deleteProject,
  listProjects,
  loadProject,
  projectExists,
  saveProject,
  type ProjectListItem,
} from './projectRepo.js';
export {
  MAX_EXPORT_HISTORY,
  addExportRecord,
  clearExportHistory,
  listExportHistory,
} from './exportHistoryRepo.js';
export {
  SettingKeys,
  deleteSetting,
  getAllSettings,
  getSetting,
  setSetting,
} from './settingsRepo.js';
export {
  createAutoSaver,
  installBeforeUnloadFlush,
  scheduleAutoSave,
  withUpdatedTimestamp,
  type AutoSaveHandle,
  type AutoSaveOptions,
} from './autoSave.js';
