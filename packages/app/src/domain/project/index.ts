/**
 * 领域层：工程子模块。
 *
 * 纯函数，零 DOM / 零 IndexedDB / 零 fetch，可在 Node 环境直接单测。
 */

export { serialize, serializeToObject } from './serialize.js';
export {
  deserialize,
  deserializeFromJson,
  type DeserializeResult,
  type DeserializeWarning,
  type DeserializeWarningCode,
} from './deserialize.js';
export {
  CURRENT_SCHEMA_VERSION,
  UnsupportedSchemaVersionError,
  compareSemver,
  isSupportedVersion,
  migrateDoc,
  semverGt,
} from './migrate.js';
export { computeProjectDuration } from './duration.js';
export { createDefaultTracks, createEmptyProject } from './factory.js';
export {
  ValidationError,
  formatValidationErrors,
  validateProjectDoc,
  type ValidationIssue,
} from './validation.js';
