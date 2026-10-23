/**
 * 工程反序列化（FR-001 / FR-003 / FR-004 / FR-063 / FR-064 / FR-063⑦）。
 *
 * 关键行为：
 * 1. **先迁移再校验**：`0.9.x` 文件经兼容层补齐字段后即可通过 v1.0 Schema 校验，
 *    低版本加载**不抛异常**（FR-001③）。
 * 2. 高版本文件直接抛 `UnsupportedSchemaVersionError`（FR-004③）。
 * 3. **在原对象上覆盖已知字段**，而不是白名单重建 —— 未知字段原样保留（forward-compatible）。
 * 4. 时间字段统一 `Math.round`；派生量 `meta.durationMs` 加载后立即重算覆盖。
 * 5. **告警经返回值传递**（FR-063⑦）：本函数保持**纯函数** —— 不 toast、不碰 DOM、
 *    不读写 IndexedDB、不 import i18n。「要不要告知用户」完全由调用方决定。
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
import { DURATION_RECOMPUTE_TOLERANCE_MS, fixClipDuration } from '../timeline/invariants.js';
import {
  clampClipNumericValues,
  clampProjectNumericValues,
  type ClampChange,
} from '../timeline/valueRanges.js';

/** 告警类型（FR-063⑦）。 */
export type DeserializeWarningCode = 'duration-recomputed' | 'value-clamped';

/**
 * 单条告警 —— 描述「本次加载中被系统自动改写的一处数据」。
 *
 * ⚠️ 告警是**数据**而不是 UI 行为：是否展示、展示哪一类、用什么文案，
 * 全部由调用方决定（领域层不 import i18n）。
 */
export interface DeserializeWarning {
  /** 告警类型。 */
  code: DeserializeWarningCode;
  /** 受影响的 clip id；工程级告警（`meta.durationMs` / canvas / export / track）为 `undefined`。 */
  clipId?: string;
  /**
   * 受影响的字段路径：
   * - clip 级：`'durationMs'` / `'transform.scale'` / `'text.lineHeight'`；
   * - 工程级：`'meta.durationMs'` / `'settings.canvas.width'` / `'track.height'`。
   */
  field: string;
  /** 系统采用的值（重算结果 / 钳制结果）。 */
  expected: number;
  /** 工程文件中的原值。 */
  actual: number;
}

/**
 * 反序列化结果（FR-063⑦）。
 *
 * ⚠️ `doc` 必须是**纯 `ProjectDoc`** —— 其上**不得**挂载 `warnings` 字段。
 * `serialize.ts` 的 `canonicalObject()` 保留未知键，且 Schema 顶层
 * `additionalProperties: true` → 挂在 doc 上的 `warnings` 会被写进用户保存的
 * 工程文件，造成**用户数据污染**。
 */
export interface DeserializeResult {
  /** 反序列化后的工程文档。 */
  doc: ProjectDoc;
  /** 本次加载中被系统自动修正的不一致项；无修正时为空数组（绝不占位）。 */
  warnings: DeserializeWarning[];
}

/**
 * 内部：带排序键的告警。
 *
 * 排序键只用于**产出确定性顺序**，排序完成后即被剥离 ——
 * 对外暴露的只有 `DeserializeWarning` 的公开字段。
 */
interface RankedWarning {
  /** 告警本体。 */
  readonly warning: DeserializeWarning;
  /** 所属轨道序号；工程级告警为 `-1`。 */
  readonly trackIndex: number;
  /** 所属 clip 序号；工程级 / 轨道级告警为 `-1`。 */
  readonly clipIndex: number;
}

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
 * 告警排序（FR-063⑦ 确定性要求）。
 *
 * 规则：
 * 1. `duration-recomputed` 在前、`value-clamped` 在后；
 * 2. 组内按 track 顺序 → clip 顺序 → 字段路径字典序。
 *
 * 工程级告警（`meta.durationMs` / canvas / export / track）的 track / clip 序号均为 `-1`，
 * 因此排在同组最前面；完全同键时保持**插入顺序**（`Array.prototype.sort` 稳定）。
 */
function compareRankedWarnings(a: RankedWarning, b: RankedWarning): number {
  const groupA = a.warning.code === 'duration-recomputed' ? 0 : 1;
  const groupB = b.warning.code === 'duration-recomputed' ? 0 : 1;
  if (groupA !== groupB) return groupA - groupB;
  if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
  if (a.clipIndex !== b.clipIndex) return a.clipIndex - b.clipIndex;
  if (a.warning.field === b.warning.field) return 0;
  return a.warning.field < b.warning.field ? -1 : 1;
}

/**
 * 反序列化工程。
 *
 * @param json 解析后的 JSON 对象（`JSON.parse` 的结果）
 * @returns 工程文档 + 本次加载中被系统自动修正的不一致项（FR-063⑦）
 * @throws UnsupportedSchemaVersionError 文件版本高于当前应用
 * @throws ValidationError 数据不符合 JSON Schema
 */
export function deserialize(json: unknown): DeserializeResult {
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

  const clampedDoc = migrated as unknown as ProjectDoc;

  // 6) 数值范围钳制（FR-064）
  //    与 `setClipProperty` 共用 `valueRanges.ts` 的同一张约束表，
  //    保证「编辑路径」与「导入路径」的数值约束完全一致。
  //    钳制函数把「改了什么」回报给收集器（FR-063⑦）—— 不传收集器时行为完全不变。
  const ranked: RankedWarning[] = [];

  const projectChanges: ClampChange[] = [];
  clampProjectNumericValues(clampedDoc, { changes: projectChanges });
  for (const change of projectChanges) {
    ranked.push({
      warning: {
        code: 'value-clamped',
        field: change.path,
        expected: change.expected,
        actual: change.actual,
      },
      trackIndex: -1,
      clipIndex: -1,
    });
  }

  for (const [trackIndex, track] of clampedDoc.tracks.entries()) {
    for (const [clipIndex, clip] of track.clips.entries()) {
      const clipChanges: ClampChange[] = [];
      clampClipNumericValues(clip, { changes: clipChanges });
      for (const change of clipChanges) {
        ranked.push({
          warning: {
            code: 'value-clamped',
            clipId: clip.id,
            field: change.path,
            expected: change.expected,
            actual: change.actual,
          },
          trackIndex,
          clipIndex,
        });
      }
    }
  }

  // 7) 派生量重算（FR-063）
  //    - clip 级：`durationMs` 是**派生量**，必须按 `round((outMs - inMs) / speed)` 重算。
  //      Schema 只能表达单字段边界，无法表达 in/out/speed/durationMs 的**交叉约束**，
  //      所以导入时必须由领域层重算，否则篡改过的 durationMs 会被原样写回并扩散。
  //    - 文字 clip（assetId === null）按 PRD「时长独立于素材」豁免，`fixClipDuration` 原样返回。
  for (const [trackIndex, track] of clampedDoc.tracks.entries()) {
    for (const [clipIndex, clip] of track.clips.entries()) {
      // 源区间倒置是**结构性非法**，无法通过重算修正 → 显式拒绝。
      if (clip.assetId !== null && clip.outMs <= clip.inMs) {
        throw new ValidationError([
          {
            path: `/tracks/${trackIndex}`,
            message: 'inverted source range',
            hint: `片段「${clip.label ?? clip.id}」的源区间倒置（inMs=${clip.inMs} ≥ outMs=${clip.outMs}），无法修正。`,
          },
        ]);
      }
      // 快照「重算前的 durationMs」，与重算结果比较（FR-063⑦）。
      // 文字 clip 的 `fixClipDuration` 原样返回 → expected === actual → 天然不产生告警。
      const actual = clip.durationMs;
      const expected = fixClipDuration(clip as unknown as Clip).durationMs;
      clip.durationMs = expected;
      if (Math.abs(expected - actual) > DURATION_RECOMPUTE_TOLERANCE_MS) {
        ranked.push({
          warning: {
            code: 'duration-recomputed',
            clipId: clip.id,
            field: 'durationMs',
            expected,
            actual,
          },
          trackIndex,
          clipIndex,
        });
      }
    }
  }

  // 8) 工程级派生量重算
  //    `meta.durationMs` 是**派生量**：工程总时长是用户直接看得见的数字，
  //    因此它与 clip 级派生量适用同一套告警规则（FR-063⑦）。
  const metaActual = clampedDoc.meta.durationMs;
  const metaExpected = computeProjectDuration(clampedDoc);
  clampedDoc.meta.durationMs = metaExpected;
  if (Math.abs(metaExpected - metaActual) > DURATION_RECOMPUTE_TOLERANCE_MS) {
    ranked.push({
      warning: {
        code: 'duration-recomputed',
        field: 'meta.durationMs',
        expected: metaExpected,
        actual: metaActual,
      },
      trackIndex: -1,
      clipIndex: -1,
    });
  }

  ranked.sort(compareRankedWarnings);

  return {
    doc: clampedDoc,
    warnings: ranked.map((entry) => entry.warning),
  };
}

/**
 * 从 JSON 文本反序列化。
 *
 * 与 `deserialize` **返回类型完全相同**（FR-063⑦ ⑦-4）——
 * 不存在「不带告警的平行入口」。
 */
export function deserializeFromJson(text: string): DeserializeResult {
  return deserialize(JSON.parse(text) as unknown);
}
