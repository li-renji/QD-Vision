/**
 * 版本兼容层。
 *
 * - 低版本（`0.9.x`）→ 走迁移函数补齐缺省字段，**不抛异常**（FR-001③）。
 * - 高版本 → 抛 `UnsupportedSchemaVersionError`，明确提示「文件版本过高」（FR-004③）。
 */

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_AUDIO_PROPS,
  DEFAULT_CANVAS,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_TRANSFORM,
  type Clip,
  type ClipTextProps,
  type ProjectDoc,
  type Track,
} from '@clipcut/shared-types';

export { CURRENT_SCHEMA_VERSION };

/** 工程文件版本过高。 */
export class UnsupportedSchemaVersionError extends Error {
  /** 文件声明的版本。 */
  readonly fileVersion: string;
  /** 当前应用支持的版本。 */
  readonly supportedVersion: string;

  constructor(fileVersion: string, supportedVersion = CURRENT_SCHEMA_VERSION) {
    super(
      `工程文件版本过高：${fileVersion}，当前应用仅支持 ${supportedVersion}。` +
        `请升级 ClipCut Web 后再打开该文件。`,
    );
    this.name = 'UnsupportedSchemaVersionError';
    this.fileVersion = fileVersion;
    this.supportedVersion = supportedVersion;
  }
}

/** 解析 `x.y.z` 版本号为三元组。 */
export function parseSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return [0, 0, 0];
  return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** 比较两个版本：a > b 返回正数，a < b 返回负数，相等返回 0。 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** a 是否大于 b。 */
export function semverGt(a: string, b: string): boolean {
  return compareSemver(a, b) > 0;
}

/** 版本是否被当前应用支持（不高于当前版本即可，兼容性由迁移函数负责）。 */
export function isSupportedVersion(version: string): boolean {
  return !semverGt(version, CURRENT_SCHEMA_VERSION);
}

/** 为 clip 补齐 0.9.x 缺失的字段。 */
function migrateClip(clip: Clip): Clip {
  const next: Clip = {
    ...clip,
    zIndex: typeof clip.zIndex === 'number' ? clip.zIndex : 0,
    isOverlay: typeof clip.isOverlay === 'boolean' ? clip.isOverlay : false,
    speed: typeof clip.speed === 'number' && clip.speed > 0 ? clip.speed : 1,
    transform: { ...DEFAULT_TRANSFORM, ...(clip.transform ?? {}) },
    audio: { ...DEFAULT_AUDIO_PROPS, ...(clip.audio ?? {}) },
    label: clip.label ?? null,
  };
  if (clip.text) {
    next.text = { ...(next.text as ClipTextProps) };
  }
  return next;
}

/** 为 track 补齐缺省字段。 */
function migrateTrack(track: Track): Track {
  return {
    ...track,
    order: typeof track.order === 'number' ? track.order : 0,
    muted: track.muted ?? false,
    hidden: track.hidden ?? false,
    locked: track.locked ?? false,
    height: typeof track.height === 'number' ? track.height : 56,
    clips: (track.clips ?? []).map(migrateClip),
  };
}

/**
 * `0.9.x` → `1.0.0` 迁移。
 *
 * 补齐：`settings.ai.providers` / `settings.ai.routes`、clip 的 `zIndex` / `transform` / `audio`、
 * track 的 `hidden` / `locked` / `height`、字幕样式缺省值。
 */
export function migrateFrom09(doc: ProjectDoc): ProjectDoc {
  const settings = doc.settings ?? ({} as ProjectDoc['settings']);
  const ai = settings.ai ?? ({} as ProjectDoc['settings']['ai']);

  return {
    ...doc,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: {
      ...settings,
      canvas: { ...DEFAULT_CANVAS, ...(settings.canvas ?? {}) },
      export: { ...DEFAULT_EXPORT_SETTINGS, ...(settings.export ?? {}) },
      ai: {
        ...ai,
        routes: ai.routes ?? {},
        providers: ai.providers ?? {},
      },
    },
    tracks: (doc.tracks ?? []).map(migrateTrack),
    subtitles: {
      ...(doc.subtitles ?? { enabled: false, style: DEFAULT_SUBTITLE_STYLE, cues: [] }),
      enabled: doc.subtitles?.enabled ?? false,
      style: { ...DEFAULT_SUBTITLE_STYLE, ...(doc.subtitles?.style ?? {}) },
      cues: doc.subtitles?.cues ?? [],
    },
    meta: {
      ...(doc.meta ?? { durationMs: 0, lastExport: null }),
      durationMs: doc.meta?.durationMs ?? 0,
      lastExport: doc.meta?.lastExport ?? null,
    },
  };
}

/** 迁移函数注册表：`fromVersion` → 迁移函数。 */
const MIGRATIONS: Record<string, (doc: ProjectDoc) => ProjectDoc> = {
  '0.9': migrateFrom09,
};

/**
 * 执行迁移链。
 *
 * @param doc 原始文档（版本号可能低于当前）
 * @throws UnsupportedSchemaVersionError 当文件版本高于当前应用
 */
export function migrateDoc(doc: ProjectDoc): ProjectDoc {
  const version = doc.schemaVersion ?? '0.9.0';
  if (semverGt(version, CURRENT_SCHEMA_VERSION)) {
    throw new UnsupportedSchemaVersionError(version);
  }
  if (version === CURRENT_SCHEMA_VERSION) {
    return doc;
  }

  const majorMinor = version.split('.').slice(0, 2).join('.');
  const migration = MIGRATIONS[majorMinor];
  if (!migration) {
    // 没有针对性迁移函数时，做一次「补默认值」的通用兼容处理。
    return migrateFrom09({ ...doc, schemaVersion: CURRENT_SCHEMA_VERSION });
  }
  return migration(doc);
}
