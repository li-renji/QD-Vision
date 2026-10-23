/**
 * 工程反序列化（FR-001 / FR-003 / FR-004）。
 *
 * 关键行为：
 * 1. **先迁移再校验**：`0.9.x` 文件经兼容层补齐字段后即可通过 v1.0 Schema 校验，
 *    低版本加载**不抛异常**（FR-001③）。
 * 2. 高版本文件直接抛 `UnsupportedSchemaVersionError`（FR-004③）。
 * 3. **在原对象上覆盖已知字段**，而不是白名单重建 —— 未知字段原样保留（forward-compatible）。
 * 4. 时间字段统一 `Math.round`；派生量 `meta.durationMs` 加载后立即重算覆盖。
 */

import {
  DEFAULT_AUDIO_PROPS,
  DEFAULT_CANVAS,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_TRANSFORM,
  type Asset,
  type Clip,
  type ProjectDoc,
  type Track,
} from '@clipcut/shared-types';
import { computeProjectDuration } from './duration.js';
import { migrateDoc, UnsupportedSchemaVersionError } from './migrate.js';
import { validateProjectDoc, ValidationError } from './validation.js';
import { fixClipDuration } from '../timeline/invariants.js';
import { clampClipNumericValues, clampProjectNumericValues } from '../timeline/valueRanges.js';

/** 需要取整的时间字段。 */
const TIME_FIELDS = [
  'startMs',
  'durationMs',
  'inMs',
  'outMs',
  'fadeInMs',
  'fadeOutMs',
  'endMs',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * **只补齐缺失的键**，绝不覆盖已有值。
 *
 * （早期实现误用 `Object.assign`，会把用户已自定义的 transform / audio 参数重置为默认值。）
 */
function fillMissing(target: Record<string, unknown>, defaults: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

/** 就地把对象内的数值型时间字段取整。 */
function roundTimeFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) roundTimeFields(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const field of TIME_FIELDS) {
    const current = value[field];
    if (typeof current === 'number' && Number.isFinite(current)) {
      value[field] = Math.round(current);
    }
  }
  for (const nested of Object.values(value)) {
    if (typeof nested === 'object' && nested !== null) roundTimeFields(nested);
  }
}

/** 就地补齐 clip 的缺省字段。 */
function fillClipDefaults(clip: Clip): void {
  if (!isRecord(clip.transform)) {
    (clip as Record<string, unknown>)['transform'] = { ...DEFAULT_TRANSFORM };
  } else {
    fillMissing(clip.transform, DEFAULT_TRANSFORM as unknown as Record<string, unknown>);
  }
  if (!isRecord(clip.audio)) {
    (clip as Record<string, unknown>)['audio'] = { ...DEFAULT_AUDIO_PROPS };
  } else {
    fillMissing(clip.audio, DEFAULT_AUDIO_PROPS as unknown as Record<string, unknown>);
  }
  if (typeof clip.zIndex !== 'number') clip.zIndex = 0;
  if (typeof clip.isOverlay !== 'boolean') clip.isOverlay = false;
  if (typeof clip.speed !== 'number' || clip.speed <= 0) clip.speed = 1;
  if (clip.label === undefined) clip.label = null;
}

/** 就地补齐 track 的缺省字段。 */
function fillTrackDefaults(track: Track): void {
  if (typeof track.order !== 'number') track.order = 0;
  if (typeof track.muted !== 'boolean') track.muted = false;
  if (typeof track.hidden !== 'boolean') track.hidden = false;
  if (typeof track.locked !== 'boolean') track.locked = false;
  if (typeof track.height !== 'number' || track.height <= 0) track.height = 56;
  if (!Array.isArray(track.clips)) {
    (track as Record<string, unknown>)['clips'] = [];
    return;
  }
  for (const clip of track.clips) fillClipDefaults(clip);
}

/** 就地补齐 asset 的缺省字段。 */
function fillAssetDefaults(asset: Asset): void {
  if (asset.blobKey === undefined) asset.blobKey = null;
  if (asset.proxyBlobKey === undefined) asset.proxyBlobKey = null;
  if (asset.thumbnailBlobKey === undefined) asset.thumbnailBlobKey = null;
  if (asset.waveform === undefined) asset.waveform = null;
  if (asset.width === undefined) asset.width = null;
  if (asset.height === undefined) asset.height = null;
  if (asset.frameRate === undefined) asset.frameRate = null;
  if (asset.videoCodec === undefined) asset.videoCodec = null;
  if (asset.license === undefined) asset.license = null;
  if (typeof asset.playable !== 'boolean') asset.playable = true;
  if (typeof asset.hasAudio !== 'boolean') asset.hasAudio = false;
  if (typeof asset.durationMs !== 'number') asset.durationMs = 0;
}

/**
 * 反序列化工程。
 *
 * @param json 解析后的 JSON 对象（`JSON.parse` 的结果）
 * @throws UnsupportedSchemaVersionError 文件版本高于当前应用
 * @throws ValidationError 数据不符合 JSON Schema
 */
export function deserialize(json: unknown): ProjectDoc {
  if (!isRecord(json)) {
    throw new ValidationError([{ path: '', message: 'invalid', hint: '工程数据必须是一个对象' }]);
  }

  const version = typeof json['schemaVersion'] === 'string' ? json['schemaVersion'] : '0.9.0';

  // 1) 版本检查（高版本直接拒绝）
  if (version !== '0.9.0' && version !== '1.0.0') {
    // migrateDoc 内部会做精确的高版本判断，这里提前拦截以避免误迁移。
    try {
      migrateDoc(json as unknown as ProjectDoc);
    } catch (error) {
      if (error instanceof UnsupportedSchemaVersionError) throw error;
      throw error;
    }
  }

  // 2) 迁移（补齐 0.9.x 缺失字段，保留未知字段）
  const migrated = migrateDoc(json as unknown as ProjectDoc) as unknown as Record<string, unknown>;

  // 3) 校验（v1.0 Schema）
  const issues = validateProjectDoc(migrated);
  if (issues.length > 0) throw new ValidationError(issues);

  // 4) 在原对象上覆盖已知字段（不白名单重建 → 未知字段保留）
  const settings = isRecord(migrated['settings']) ? migrated['settings'] : {};
  if (!isRecord(settings['canvas'])) settings['canvas'] = { ...DEFAULT_CANVAS };
  if (!isRecord(settings['export'])) settings['export'] = { ...DEFAULT_EXPORT_SETTINGS };
  if (!isRecord(settings['ai'])) settings['ai'] = { routes: {}, providers: {} };
  migrated['settings'] = settings;

  const subtitles = isRecord(migrated['subtitles']) ? migrated['subtitles'] : {};
  if (!isRecord(subtitles['style'])) subtitles['style'] = { ...DEFAULT_SUBTITLE_STYLE };
  if (!Array.isArray(subtitles['cues'])) subtitles['cues'] = [];
  migrated['subtitles'] = subtitles;

  const meta = isRecord(migrated['meta']) ? migrated['meta'] : {};
  if (meta['lastExport'] === undefined) meta['lastExport'] = null;
  migrated['meta'] = meta;

  const assets = isRecord(migrated['assets']) ? migrated['assets'] : {};
  for (const asset of Object.values(assets)) {
    if (isRecord(asset)) fillAssetDefaults(asset as unknown as Asset);
  }
  migrated['assets'] = assets;

  const tracks = Array.isArray(migrated['tracks']) ? migrated['tracks'] : [];
  for (const track of tracks) {
    if (isRecord(track)) fillTrackDefaults(track as unknown as Track);
  }
  migrated['tracks'] = tracks;

  // 5) 时间字段取整
  roundTimeFields(migrated);

  // 6) 数值范围钳制（FR-064）
  //    与 `setClipProperty` 共用 `valueRanges.ts` 的同一张约束表，
  //    保证「编辑路径」与「导入路径」的数值约束完全一致。
  const clampedDoc = migrated as unknown as ProjectDoc;
  clampProjectNumericValues(clampedDoc);
  for (const track of clampedDoc.tracks) {
    for (const clip of track.clips) {
      clampClipNumericValues(clip);
    }
  }

  // 7) 派生量重算（FR-063）
  //    - clip 级：`durationMs` 是**派生量**，必须按 `round((outMs - inMs) / speed)` 重算。
  //      Schema 只能表达单字段边界，无法表达 in/out/speed/durationMs 的**交叉约束**，
  //      所以导入时必须由领域层重算，否则篡改过的 durationMs 会被原样写回并扩散。
  //    - 文字 clip（assetId === null）按 PRD「时长独立于素材」豁免，`fixClipDuration` 原样返回。
  for (const track of clampedDoc.tracks) {
    for (const clip of track.clips) {
      // 源区间倒置是**结构性非法**，无法通过重算修正 → 显式拒绝。
      if (clip.assetId !== null && clip.outMs <= clip.inMs) {
        throw new ValidationError([
          {
            path: `/tracks/${clampedDoc.tracks.indexOf(track)}`,
            message: 'inverted source range',
            hint: `片段「${clip.label ?? clip.id}」的源区间倒置（inMs=${clip.inMs} ≥ outMs=${clip.outMs}），无法修正。`,
          },
        ]);
      }
      clip.durationMs = fixClipDuration(clip as unknown as Clip).durationMs;
    }
  }

  // 8) 工程级派生量重算
  clampedDoc.meta.durationMs = computeProjectDuration(clampedDoc);

  return clampedDoc;
}

/**
 * 从 JSON 文本反序列化。
 */
export function deserializeFromJson(text: string): ProjectDoc {
  return deserialize(JSON.parse(text) as unknown);
}
