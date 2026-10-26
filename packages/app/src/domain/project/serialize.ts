/**
 * 工程序列化（FR-001①）。
 *
 * 目标：`serialize(deserialize(x))` 与 `serialize(deserialize(serialize(deserialize(x))))`
 * **逐字节一致**。
 *
 * 规则：
 * 1. 所有时间字段 `Math.round`（毫秒整数）。
 * 2. 键序**规范化**（已知字段按固定顺序，未知字段按原顺序追加在后面）。
 * 3. **保留未知字段**（forward-compatible）。
 * 4. 派生量 `meta.durationMs` 始终写入重算后的值。
 */

import type {
  Asset,
  Clip,
  ClipAudioProps,
  ClipTextProps,
  ClipTransform,
  ProjectDoc,
  ProjectMeta,
  SubtitleCue,
  SubtitleDoc,
  SubtitleStyle,
  Track,
} from '@clipcut/shared-types';
import { computeProjectDuration } from './duration.js';

/** 已知字段的规范顺序。 */
const DOC_KEYS = [
  'schemaVersion',
  'projectId',
  'name',
  'createdAt',
  'updatedAt',
  'generator',
  'settings',
  'assets',
  'tracks',
  'subtitles',
  'meta',
] as const;

const SETTINGS_KEYS = ['canvas', 'export', 'ai'] as const;
const CANVAS_KEYS = ['width', 'height', 'fps', 'aspectPreset', 'backgroundColor'] as const;
const EXPORT_KEYS = [
  'format',
  'width',
  'height',
  'fps',
  'videoBitrate',
  'audioBitrate',
  'burnInSubtitle',
] as const;
const AI_KEYS = ['routes', 'providers'] as const;
const TRACK_KEYS = [
  'id',
  'type',
  'name',
  'order',
  'muted',
  'hidden',
  'locked',
  'height',
  'clips',
] as const;
const CLIP_KEYS = [
  'id',
  'assetId',
  'startMs',
  'durationMs',
  'inMs',
  'outMs',
  'speed',
  'isOverlay',
  'zIndex',
  'transform',
  'audio',
  'text',
  'label',
  'filter',
] as const;
const TRANSFORM_KEYS = [
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  'fit',
  'cornerRadius',
] as const;
const AUDIO_PROPS_KEYS = ['muted', 'gain', 'fadeInMs', 'fadeOutMs', 'extracted', 'envelope'] as const;
const TEXT_PROPS_KEYS = [
  'content',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'color',
  'strokeColor',
  'strokeWidth',
  'backgroundColor',
  'lineHeight',
  'letterSpacing',
  'align',
  'verticalAlign',
] as const;
const ASSET_KEYS = [
  'id',
  'type',
  'name',
  'sourceType',
  'mimeType',
  'sizeBytes',
  'blobKey',
  'proxyBlobKey',
  'thumbnailBlobKey',
  'waveform',
  'durationMs',
  'width',
  'height',
  'frameRate',
  'hasAudio',
  'videoCodec',
  'playable',
  'license',
  'importedAt',
] as const;
const SUBTITLES_KEYS = ['enabled', 'style', 'cues'] as const;
const SUBTITLE_STYLE_KEYS = [
  'fontFamily',
  'fontSize',
  'color',
  'strokeColor',
  'strokeWidth',
  'align',
  'bottomOffsetPx',
] as const;
const CUE_KEYS = ['id', 'startMs', 'endMs', 'text'] as const;
const META_KEYS = ['durationMs', 'lastExport'] as const;
const LAST_EXPORT_KEYS = ['at', 'format', 'width', 'height', 'fps', 'sizeBytes', 'blobKey'] as const;

/** 需要取整到毫秒整数的时间字段。 */
const TIME_KEYS = new Set([
  'startMs',
  'durationMs',
  'inMs',
  'outMs',
  'fadeInMs',
  'fadeOutMs',
  'endMs',
]);

/** 把值规范化为可序列化形式。 */
function normalizeValue(key: string, value: unknown): unknown {
  if (TIME_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    // JSON 无法表达 NaN / Infinity，统一降级为 0。
    return 0;
  }
  return value;
}

/**
 * 按「已知键优先 + 未知键保留」的方式重建一个对象。
 */
function canonicalObject(
  source: Record<string, unknown>,
  knownKeys: readonly string[],
  transform?: (key: string, value: unknown) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of knownKeys) {
    if (!(key in source)) continue;
    const raw = source[key];
    const value = transform ? transform(key, raw) : raw;
    if (value === undefined) continue;
    out[key] = value;
  }
  for (const key of Object.keys(source)) {
    if (knownKeys.includes(key)) continue;
    out[key] = source[key];
  }
  return out;
}

/** 规范化 transform。 */
function serializeTransform(transform: ClipTransform): Record<string, unknown> {
  return canonicalObject(transform as unknown as Record<string, unknown>, TRANSFORM_KEYS);
}

/** 规范化音频属性。 */
function serializeAudioProps(audio: ClipAudioProps): Record<string, unknown> {
  return canonicalObject(audio as unknown as Record<string, unknown>, AUDIO_PROPS_KEYS);
}

/** 规范化文字属性。 */
function serializeTextProps(text: ClipTextProps): Record<string, unknown> {
  return canonicalObject(text as unknown as Record<string, unknown>, TEXT_PROPS_KEYS);
}

/** 规范化 clip。 */
function serializeClip(clip: Clip): Record<string, unknown> {
  const base = canonicalObject(clip as unknown as Record<string, unknown>, CLIP_KEYS, (key, value) => {
    if (key === 'transform') return serializeTransform(value as ClipTransform);
    if (key === 'audio') return serializeAudioProps(value as ClipAudioProps);
    if (key === 'text') return serializeTextProps(value as ClipTextProps);
    return normalizeValue(key, value);
  });
  return base;
}

/** 规范化 track。 */
function serializeTrack(track: Track): Record<string, unknown> {
  return canonicalObject(track as unknown as Record<string, unknown>, TRACK_KEYS, (key, value) => {
    if (key === 'clips') {
      return (value as Clip[]).map(serializeClip);
    }
    return normalizeValue(key, value);
  });
}

/** 规范化 asset。 */
function serializeAsset(asset: Asset): Record<string, unknown> {
  return canonicalObject(asset as unknown as Record<string, unknown>, ASSET_KEYS, (key, value) =>
    normalizeValue(key, value),
  );
}

/** 规范化字幕条目。 */
function serializeCue(cue: SubtitleCue): Record<string, unknown> {
  return canonicalObject(cue as unknown as Record<string, unknown>, CUE_KEYS, (key, value) =>
    normalizeValue(key, value),
  );
}

/** 规范化字幕样式。 */
function serializeSubtitleStyle(style: SubtitleStyle): Record<string, unknown> {
  return canonicalObject(style as unknown as Record<string, unknown>, SUBTITLE_STYLE_KEYS);
}

/** 规范化字幕文档。 */
function serializeSubtitles(subtitles: SubtitleDoc): Record<string, unknown> {
  return canonicalObject(subtitles as unknown as Record<string, unknown>, SUBTITLES_KEYS, (key, value) => {
    if (key === 'style') return serializeSubtitleStyle(value as SubtitleStyle);
    if (key === 'cues') return (value as SubtitleCue[]).map(serializeCue);
    return value;
  });
}

/** 规范化 meta。 */
function serializeMeta(meta: ProjectMeta): Record<string, unknown> {
  return canonicalObject(meta as unknown as Record<string, unknown>, META_KEYS, (key, value) => {
    if (key === 'lastExport' && value && typeof value === 'object') {
      return canonicalObject(value as Record<string, unknown>, LAST_EXPORT_KEYS);
    }
    return normalizeValue(key, value);
  });
}

/**
 * 把工程转换为**规范化普通对象**。
 *
 * 该对象可直接 `JSON.stringify` 得到稳定的工程 JSON。
 */
export function serializeToObject(doc: ProjectDoc): Record<string, unknown> {
  const settings = doc.settings as unknown as Record<string, unknown>;
  const canvas = (settings['canvas'] ?? {}) as Record<string, unknown>;
  const exportSettings = (settings['export'] ?? {}) as Record<string, unknown>;
  const ai = (settings['ai'] ?? {}) as Record<string, unknown>;

  const assets: Record<string, unknown> = {};
  for (const key of Object.keys(doc.assets ?? {}).sort()) {
    const asset = doc.assets[key];
    if (asset) assets[key] = serializeAsset(asset);
  }

  const routes: Record<string, unknown> = {};
  const rawRoutes = (ai['routes'] ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(rawRoutes).sort()) {
    routes[key] = rawRoutes[key] ?? null;
  }

  const providers: Record<string, unknown> = {};
  const rawProviders = (ai['providers'] ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(rawProviders).sort()) {
    const provider = rawProviders[key] as Record<string, unknown> | undefined;
    providers[key] = provider
      ? canonicalObject(provider, ['type', 'baseUrl', 'model', 'apiKey'])
      : provider;
  }

  return canonicalObject(doc as unknown as Record<string, unknown>, DOC_KEYS, (key, value) => {
    switch (key) {
      case 'settings':
        return canonicalObject(settings, SETTINGS_KEYS, (subKey, subValue) => {
          if (subKey === 'canvas') return canonicalObject(canvas, CANVAS_KEYS);
          if (subKey === 'export') return canonicalObject(exportSettings, EXPORT_KEYS);
          if (subKey === 'ai') {
            return canonicalObject(ai, AI_KEYS, (aiKey, aiValue) => {
              if (aiKey === 'routes') return routes;
              if (aiKey === 'providers') return providers;
              return aiValue;
            });
          }
          return subValue;
        });
      case 'assets':
        return assets;
      case 'tracks':
        return (value as Track[]).map(serializeTrack);
      case 'subtitles':
        return serializeSubtitles(value as SubtitleDoc);
      case 'meta':
        return { ...serializeMeta(value as ProjectMeta), durationMs: computeProjectDuration(doc) };
      default:
        return normalizeValue(key, value);
    }
  });
}

/**
 * 序列化工程为规范化 JSON 字符串。
 */
export function serialize(doc: ProjectDoc): string {
  return JSON.stringify(serializeToObject(doc));
}
