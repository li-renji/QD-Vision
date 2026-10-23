/**
 * 时间线编辑操作 —— **clip 数据的唯一写入口**（ARCHITECTURE §6.4）。
 *
 * 全部操作都是纯函数：输入 `OperationContext`，输出**新工程 + Immer patches + 逆 patches**。
 * 调用方负责把结果 commit 到 store。
 *
 * 铁律：
 * 1. 任何 clip 写操作都必须经过本文件（组件里禁止直接改 doc）。
 * 2. 每次操作结束都会跑一次 `fixClipDuration`，保证
 *    `durationMs === Math.round((outMs - inMs) / speed)` 恒成立。
 */

import { enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import {
  DEFAULT_AUDIO_PROPS,
  DEFAULT_TRANSFORM,
  REFERENCE_CANVAS_HEIGHT,
  type Asset,
  type AssetType,
  type CanvasSettings,
  type Clip,
  type ClipTextProps,
  type ExportSettings,
  type ProjectDoc,
  type ProviderConfig,
  type SubtitleCue,
  type SubtitleStyle,
  type Track,
  type TrackType,
} from '@clipcut/shared-types';
import { clipId as newClipId, cueId as newCueId, trackId as newTrackId } from '../../utils/id.js';
import {
  MAX_CLIP_SPEED,
  MIN_CLIP_DURATION_MS,
  MIN_CLIP_SPEED,
  fixClipDuration,
  minSourceSpanMs,
} from './invariants.js';
import {
  CANVAS_NUMERIC_RANGES,
  EXPORT_NUMERIC_RANGES,
  clampNumericValues,
  clampToRange,
} from './valueRanges.js';
import { DEFAULT_TEXT_PROPS } from '../project/factory.js';

// Immer 的 Patches 插件必须显式启用（撤销/重做依赖它）。
enablePatches();

// ============ 错误类型 ============

/** 时间线操作错误基类。 */
export class TimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineError';
  }
}

/** 轨道不存在。 */
export class TrackNotFoundError extends TimelineError {
  constructor(trackId: string) {
    super(`轨道不存在：${trackId}`);
    this.name = 'TrackNotFoundError';
  }
}

/** clip 不存在。 */
export class ClipNotFoundError extends TimelineError {
  constructor(clipId: string) {
    super(`clip 不存在：${clipId}`);
    this.name = 'ClipNotFoundError';
  }
}

/** 轨道类型不兼容（跨类型拖拽）。 */
export class IncompatibleTrackError extends TimelineError {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleTrackError';
  }
}

/** 不可分割（分割点在首尾 1 帧内）。 */
/** 分割被拒绝的原因。 */
export type SplitRejectionReason =
  /** 分割点距首尾不足 1 帧 */
  | 'frame-too-close'
  /** 分割后某一侧时长不足下限 */
  | 'too-short';

/**
 * 分割被拒绝（结构化）。
 *
 * 错误**不硬编码面向用户的文案** —— 文案由 UI 层用 i18n 键组装
 * （`timeline.tooShort` + `timeline.tooShort.actionLeft/Right`），
 * 这样领域层不依赖 i18n，同时 UI 能给出「可执行的替代动作」。
 */
export class NotSplittableError extends TimelineError {
  /** 拒绝原因 */
  readonly reason: SplitRejectionReason;
  /** 左侧实际时长（毫秒）；`frame-too-close` 时为 null */
  readonly leftMs: number | null;
  /** 右侧实际时长（毫秒）；`frame-too-close` 时为 null */
  readonly rightMs: number | null;
  /** 两侧都需达到的下限（毫秒） */
  readonly minMs: number;
  /** 帧周期（毫秒） */
  readonly frameMs: number;

  constructor(
    message: string,
    details: {
      reason: SplitRejectionReason;
      leftMs?: number | null;
      rightMs?: number | null;
      minMs: number;
      frameMs: number;
    },
  ) {
    super(message);
    this.name = 'NotSplittableError';
    this.reason = details.reason;
    this.leftMs = details.leftMs ?? null;
    this.rightMs = details.rightMs ?? null;
    this.minMs = details.minMs;
    this.frameMs = details.frameMs;
  }
}

/** 通用非法操作。 */
export class InvalidOperationError extends TimelineError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOperationError';
  }
}

// ============ 类型 ============

/** 操作上下文。 */
export interface OperationContext {
  /** 当前工程（只读） */
  doc: ProjectDoc;
  /** 素材表（用于越界校验） */
  assets: Record<string, Asset>;
}

/** 操作结果。 */
export interface OperationResult {
  /** 新工程（不可变更新） */
  doc: ProjectDoc;
  /** Immer patches（调试 / 审计用） */
  patches: Patch[];
  /** 逆操作（撤销用） */
  inversePatches: Patch[];
  /** 操作后需要选中的 clip */
  selectedClipId?: string | null;
}

/** 新增 clip 入参。 */
export interface AddClipInput {
  /** 文字 clip 为 null */
  assetId: string | null;
  trackId: string;
  startMs: number;
  inMs?: number;
  outMs?: number;
  speed?: number;
  text?: Partial<ClipTextProps>;
  isOverlay?: boolean;
  label?: string | null;
  /** 播放头位置：若落点在 ±50ms 内则自动吸附对齐 */
  playheadMs?: number;
}

/** 新增轨道入参。 */
export interface AddTrackInput {
  type: TrackType;
  name: string;
  /** 插入位置，省略时追加到末尾 */
  index?: number;
  height?: number;
}

// ============ 常量 ============

/** 图片素材默认时长（毫秒）—— PRD FR-010②。 */
export const DEFAULT_IMAGE_DURATION_MS = 5000;

/** 自动吸附到播放头的容差（毫秒）。 */
export const PLAYHEAD_SNAP_TOLERANCE_MS = 50;

/** 轨道默认高度。 */
const DEFAULT_TRACK_HEIGHT: Record<TrackType, number> = {
  video: 64,
  audio: 56,
  text: 48,
};

// ============ 内部工具 ============

/** 判断素材能否放到该类型的轨道上。 */
export function canPlaceAsset(trackType: TrackType, assetType: AssetType): boolean {
  if (trackType === 'text') {
    // 文字轨可以承载画中画（视频 / 图片素材），PRD §7 Q3。
    return assetType === 'video' || assetType === 'image';
  }
  if (trackType === 'video') {
    // 视频轨只接受视频 / 图片素材（音频素材禁止）。
    return assetType === 'video' || assetType === 'image';
  }
  // 音频轨只接受音频素材。
  return assetType === 'audio';
}

/** 找到草稿中的轨道。 */
function draftTrack(draft: Draft<ProjectDoc>, trackId: string): Draft<Track> | undefined {
  return draft.tracks.find((track) => track.id === trackId);
}

/** 在草稿中定位 clip 及其所属轨道。 */
function locateClip(
  draft: Draft<ProjectDoc>,
  clipId: string,
): { track: Draft<Track>; clip: Draft<Clip> } | null {
  for (const track of draft.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** 取得素材。 */
function resolveAsset(ctx: OperationContext, assetId: string | null): Asset | undefined {
  if (!assetId) return undefined;
  return ctx.assets[assetId] ?? ctx.doc.assets[assetId];
}

/** 取 clip 的源区间长度（毫秒，未含变速）。 */
function sourceSpanMs(clip: Clip): number {
  return Math.max(0, clip.outMs - clip.inMs);
}

/** 执行一次 Immer patch 产出。 */
function run(doc: ProjectDoc, recipe: (draft: Draft<ProjectDoc>) => void): OperationResult {
  const [nextDoc, patches, inversePatches] = produceWithPatches(doc, recipe);
  return { doc: nextDoc, patches, inversePatches };
}

/** 构造默认文字属性。 */
function buildTextProps(partial?: Partial<ClipTextProps>): ClipTextProps {
  return { ...DEFAULT_TEXT_PROPS, ...(partial ?? {}) };
}

// ============ 操作实现 ============

/**
 * 新增 clip。
 *
 * - 跨类型轨道**禁止**（视频/图片 → 视频轨或文字轨；音频 → 音频轨）。
 * - 图片素材默认 5s 时长。
 * - 落点接近播放头时自动吸附。
 */
export function addClip(ctx: OperationContext, input: AddClipInput): OperationResult {
  const track = ctx.doc.tracks.find((item) => item.id === input.trackId);
  if (!track) throw new TrackNotFoundError(input.trackId);
  if (track.locked) throw new InvalidOperationError(`轨道已锁定：${track.name}`);

  const asset = resolveAsset(ctx, input.assetId);
  if (input.assetId !== null && !asset) {
    throw new InvalidOperationError(`素材不存在：${input.assetId}`);
  }
  if (input.assetId !== null && asset && !asset.playable) {
    throw new InvalidOperationError(
      `素材「${asset.name}」无法在浏览器中解码（需转码），不能添加到时间线`,
    );
  }

  const assetType: AssetType = asset ? asset.type : 'image';
  if (!canPlaceAsset(track.type, assetType)) {
    throw new IncompatibleTrackError(
      `不能把${assetType === 'audio' ? '音频' : assetType === 'video' ? '视频' : '图片'}素材放到${
        track.type === 'audio' ? '音频' : track.type === 'video' ? '视频' : '文字'
      }轨`,
    );
  }

  const speed = clamp(input.speed ?? 1, MIN_CLIP_SPEED, MAX_CLIP_SPEED);
  const inMs = Math.max(0, Math.round(input.inMs ?? 0));

  let outMs: number;
  if (input.outMs !== undefined) {
    outMs = Math.round(input.outMs);
  } else if (asset && asset.type === 'image') {
    outMs = inMs + DEFAULT_IMAGE_DURATION_MS;
  } else if (asset) {
    outMs = Math.round(asset.durationMs);
  } else {
    outMs = inMs;
  }

  // 源区间必须覆盖「最小时长 × speed」，否则变速后的时间线时长会短于 MIN_CLIP_DURATION_MS。
  const minSpan = minSourceSpanMs(speed);
  if (asset && asset.durationMs > 0) {
    outMs = Math.min(outMs, Math.round(asset.durationMs));
  }
  if (outMs - inMs < minSpan) {
    const expanded = inMs + minSpan;
    const assetDuration = asset && asset.durationMs > 0 ? Math.round(asset.durationMs) : null;
    if (assetDuration !== null && expanded > assetDuration) {
      throw new InvalidOperationError(
        `素材过短：${asset?.name ?? '素材'} 仅 ${assetDuration}ms，无法满足 ${minSpan}ms 源区间要求（speed=${speed}）`,
      );
    }
    outMs = expanded;
  }

  let startMs = Math.max(0, Math.round(input.startMs));
  if (input.playheadMs !== undefined) {
    const delta = input.playheadMs - startMs;
    if (Math.abs(delta) <= PLAYHEAD_SNAP_TOLERANCE_MS) startMs = Math.round(input.playheadMs);
  }

  const isTextClip = input.assetId === null;
  // 忠实按公式计算，不做钳制 —— 见 invariants.ts 文件头的一致性契约。
  const durationMs = Math.round((outMs - inMs) / speed);

  const clipId = newClipId();
  const isOverlay = isTextClip
    ? true
    : track.type === 'text'
      ? true
      : (input.isOverlay ?? false);

  const zIndex = isOverlay
    ? ctx.doc.tracks
        .flatMap((item) => item.clips)
        .filter((item) => item.isOverlay)
        .reduce((max, item) => Math.max(max, item.zIndex + 1), 0)
    : 0;

  const result = run(ctx.doc, (draft) => {
    const draftTarget = draftTrack(draft, input.trackId);
    if (!draftTarget) throw new TrackNotFoundError(input.trackId);
    draftTarget.clips.push({
      id: clipId,
      assetId: input.assetId,
      startMs,
      durationMs,
      inMs,
      outMs,
      speed,
      isOverlay,
      zIndex,
      transform: { ...DEFAULT_TRANSFORM },
      audio: { ...DEFAULT_AUDIO_PROPS },
      ...(isTextClip ? { text: buildTextProps(input.text) } : {}),
      label: input.label ?? null,
    } as Draft<Clip>);
  });

  return { ...result, selectedClipId: clipId };
}

/**
 * 新建文字片段（文字轨）。
 */
export function addTextClip(
  ctx: OperationContext,
  input: { trackId: string; startMs: number; durationMs: number; content: string },
): OperationResult {
  const durationMs = Math.max(MIN_CLIP_DURATION_MS, Math.round(input.durationMs));
  return addClip(ctx, {
    assetId: null,
    trackId: input.trackId,
    startMs: input.startMs,
    inMs: 0,
    outMs: durationMs,
    text: { content: input.content },
  });
}

/**
 * 移动 clip（同轨改 `startMs`，跨轨改所属轨道）。
 */
export function moveClip(
  ctx: OperationContext,
  clipId: string,
  toTrackId: string,
  newStartMs: number,
): OperationResult {
  const source = ctx.doc.tracks.find((track) =>
    track.clips.some((clip) => clip.id === clipId),
  );
  if (!source) throw new ClipNotFoundError(clipId);
  if (source.locked) throw new InvalidOperationError(`轨道已锁定：${source.name}`);

  const target = ctx.doc.tracks.find((track) => track.id === toTrackId);
  if (!target) throw new TrackNotFoundError(toTrackId);
  if (target.locked) throw new InvalidOperationError(`轨道已锁定：${target.name}`);

  const clip = source.clips.find((item) => item.id === clipId);
  if (!clip) throw new ClipNotFoundError(clipId);

  // 跨轨时校验类型兼容
  if (source.id !== target.id) {
    const asset = resolveAsset(ctx, clip.assetId);
    const assetType: AssetType = asset ? asset.type : 'image';
    if (!canPlaceAsset(target.type, assetType)) {
      throw new IncompatibleTrackError(
        `不能把${assetType === 'audio' ? '音频' : assetType === 'video' ? '视频' : '图片'}clip 移动到${
          target.type === 'audio' ? '音频' : target.type === 'video' ? '视频' : '文字'
        }轨`,
      );
    }
  }

  const startMs = Math.max(0, Math.round(newStartMs));

  const result = run(ctx.doc, (draft) => {
    const located = locateClip(draft, clipId);
    if (!located) throw new ClipNotFoundError(clipId);
    const moving = { ...located.clip } as Draft<Clip>;
    moving.startMs = startMs;
    if (located.track.id !== target.id) {
      located.track.clips = located.track.clips.filter((item) => item.id !== clipId);
      const draftTarget = draftTrack(draft, target.id);
      if (!draftTarget) throw new TrackNotFoundError(target.id);
      draftTarget.clips.push(moving);
    } else {
      located.clip.startMs = startMs;
    }
  });

  return { ...result, selectedClipId: clipId };
}

/**
 * 裁剪 clip。
 *
 * - `edge === 'in'`：修改 `inMs`；
 * - `edge === 'out'`：修改 `outMs`。
 * 越界自动钳制，最小时长 100ms。
 */
export function trimClip(
  ctx: OperationContext,
  clipId: string,
  edge: 'in' | 'out',
  newValueMs: number,
): OperationResult {
  const located = ctx.doc.tracks
    .map((track) => ({ track, clip: track.clips.find((item) => item.id === clipId) }))
    .find((entry) => entry.clip);
  if (!located || !located.clip) throw new ClipNotFoundError(clipId);
  if (located.track.locked) throw new InvalidOperationError(`轨道已锁定：${located.track.name}`);

  const clip = located.clip;
  const asset = resolveAsset(ctx, clip.assetId);
  const assetDuration = asset ? Math.round(asset.durationMs) : Number.POSITIVE_INFINITY;
  const value = Math.round(newValueMs);

  let inMs = clip.inMs;
  let outMs = clip.outMs;

  // 裁剪只在**源区间**上做钳制：源跨度必须 ≥ MIN_CLIP_DURATION_MS × speed，
  // 这样无论当前 speed 是多少，重算出的 durationMs 都不会短于最小时长。
  const minSpan = minSourceSpanMs(clip.speed);

  if (edge === 'in') {
    inMs = Math.min(Math.max(0, value), outMs - minSpan);
  } else {
    outMs = Math.max(value, inMs + minSpan);
    if (Number.isFinite(assetDuration)) {
      outMs = Math.min(outMs, assetDuration);
    }
  }

  if (outMs - inMs < minSpan) {
    throw new InvalidOperationError(
      `裁剪后时长不足 ${MIN_CLIP_DURATION_MS}ms（当前 ${outMs - inMs}ms，speed=${clip.speed} 时源区间需 ≥ ${minSpan}ms）`,
    );
  }

  const result = run(ctx.doc, (draft) => {
    const found = locateClip(draft, clipId);
    if (!found) throw new ClipNotFoundError(clipId);
    found.clip.inMs = inMs;
    found.clip.outMs = outMs;
    const fixed = fixClipDuration(found.clip as unknown as Clip);
    found.clip.durationMs = fixed.durationMs;
  });

  return { ...result, selectedClipId: clipId };
}

/**
 * 分割 clip。
 *
 * 两侧共享同一素材引用，`inMs` / `outMs` 独立。
 */
export function splitClip(ctx: OperationContext, clipId: string, atMs: number): OperationResult {
  const located = ctx.doc.tracks
    .map((track) => ({ track, clip: track.clips.find((item) => item.id === clipId) }))
    .find((entry) => entry.clip);
  if (!located || !located.clip) throw new ClipNotFoundError(clipId);
  if (located.track.locked) throw new InvalidOperationError(`轨道已锁定：${located.track.name}`);

  const clip = located.clip;
  const fps = ctx.doc.settings.canvas.fps || 30;
  const frameMs = 1000 / fps;
  const at = Math.round(atMs);
  const clipStart = clip.startMs;
  const clipEnd = clip.startMs + clip.durationMs;

  if (at <= clipStart + frameMs || at >= clipEnd - frameMs) {
    throw new NotSplittableError(
      `分割点距 clip 首尾不足 1 帧（${frameMs.toFixed(1)}ms），无法分割`,
      {
        reason: 'frame-too-close',
        leftMs: at - clipStart,
        rightMs: clipEnd - at,
        minMs: MIN_CLIP_DURATION_MS,
        frameMs,
      },
    );
  }

  const leftId = newClipId();
  const rightId = newClipId();
  const leftDuration = at - clipStart;
  const rightDuration = clipEnd - at;

  // 分割后两侧都必须满足最小时长，否则会产出违规 clip。
  // 错误携带**结构化数据**（left / right / min / frame），UI 层用 i18n 键
  // 组装「含可执行替代动作」的文案（FR-018③）。
  if (leftDuration < MIN_CLIP_DURATION_MS || rightDuration < MIN_CLIP_DURATION_MS) {
    throw new NotSplittableError(
      `分割后任一侧时长不足 ${MIN_CLIP_DURATION_MS}ms（左 ${leftDuration}ms / 右 ${rightDuration}ms）`,
      {
        reason: 'too-short',
        leftMs: leftDuration,
        rightMs: rightDuration,
        minMs: MIN_CLIP_DURATION_MS,
        frameMs,
      },
    );
  }

  const sourceOffset = leftDuration * clip.speed;
  const leftOut = Math.round(clip.inMs + sourceOffset);

  const result = run(ctx.doc, (draft) => {
    const found = locateClip(draft, clipId);
    if (!found) throw new ClipNotFoundError(clipId);
    const original = found.clip;

    const left: Draft<Clip> = {
      ...(original as unknown as Clip),
      id: leftId,
      startMs: clipStart,
      durationMs: leftDuration,
      outMs: leftOut,
    } as Draft<Clip>;

    const right: Draft<Clip> = {
      ...(original as unknown as Clip),
      id: rightId,
      startMs: at,
      durationMs: rightDuration,
      inMs: leftOut,
    } as Draft<Clip>;

    const index = found.track.clips.findIndex((item) => item.id === clipId);
    found.track.clips.splice(index, 1, left, right);
  });

  return { ...result, selectedClipId: rightId };
}

/**
 * 删除 clip。
 */
export function deleteClip(ctx: OperationContext, clipId: string): OperationResult {
  const located = ctx.doc.tracks
    .map((track) => ({ track, clip: track.clips.find((item) => item.id === clipId) }))
    .find((entry) => entry.clip);
  if (!located || !located.clip) throw new ClipNotFoundError(clipId);
  if (located.track.locked) throw new InvalidOperationError(`轨道已锁定：${located.track.name}`);

  const result = run(ctx.doc, (draft) => {
    const found = locateClip(draft, clipId);
    if (!found) throw new ClipNotFoundError(clipId);
    found.track.clips = found.track.clips.filter((item) => item.id !== clipId);
  });

  return result;
}

/**
 * 复制 clip 到指定轨道的指定位置（保持 `in/out/speed/transform` 不变）。
 */
export function duplicateClip(
  ctx: OperationContext,
  clipId: string,
  toTrackId: string,
  atMs: number,
): OperationResult {
  const source = ctx.doc.tracks
    .map((track) => ({ track, clip: track.clips.find((item) => item.id === clipId) }))
    .find((entry) => entry.clip);
  if (!source || !source.clip) throw new ClipNotFoundError(clipId);

  const target = ctx.doc.tracks.find((track) => track.id === toTrackId);
  if (!target) throw new TrackNotFoundError(toTrackId);
  if (target.locked) throw new InvalidOperationError(`轨道已锁定：${target.name}`);

  const clip = source.clip;
  const asset = resolveAsset(ctx, clip.assetId);
  const assetType: AssetType = asset ? asset.type : 'image';
  if (source.track.id !== target.id && !canPlaceAsset(target.type, assetType)) {
    throw new IncompatibleTrackError(`不能把${assetType} clip 复制到${target.type}轨`);
  }

  const newId = newClipId();
  const startMs = Math.max(0, Math.round(atMs));

  const result = run(ctx.doc, (draft) => {
    const draftTarget = draftTrack(draft, toTrackId);
    if (!draftTarget) throw new TrackNotFoundError(toTrackId);
    draftTarget.clips.push({
      ...(clip as unknown as Clip),
      id: newId,
      startMs,
    } as Draft<Clip>);
  });

  return { ...result, selectedClipId: newId };
}

/**
 * 设置 clip 速度。
 *
 * 保持 `inMs` / `outMs` 不变，重算 `durationMs = (outMs - inMs) / speed`。
 */
export function setClipSpeed(ctx: OperationContext, clipId: string, speed: number): OperationResult {
  const located = ctx.doc.tracks
    .map((track) => ({ track, clip: track.clips.find((item) => item.id === clipId) }))
    .find((entry) => entry.clip);
  if (!located || !located.clip) throw new ClipNotFoundError(clipId);
  if (located.track.locked) throw new InvalidOperationError(`轨道已锁定：${located.track.name}`);

  const clip = located.clip;
  const nextSpeed = clamp(speed, MIN_CLIP_SPEED, MAX_CLIP_SPEED);

  // FR-020②：改 speed 时保持 inMs / outMs 不变，只重算 durationMs。
  // 若新速度会让时长短于最小时长，则**拒绝操作**而不是产出违规数据。
  const minSpan = minSourceSpanMs(nextSpeed);
  if (clip.outMs - clip.inMs < minSpan) {
    throw new InvalidOperationError(
      `变速到 ${nextSpeed}x 后时长将不足 ${MIN_CLIP_DURATION_MS}ms` +
        `（源区间 ${clip.outMs - clip.inMs}ms，${nextSpeed}x 时需 ≥ ${minSpan}ms）`,
    );
  }

  const result = run(ctx.doc, (draft) => {
    const found = locateClip(draft, clipId);
    if (!found) throw new ClipNotFoundError(clipId);
    found.clip.speed = nextSpeed;
    const fixed = fixClipDuration(found.clip as unknown as Clip);
    found.clip.durationMs = fixed.durationMs;
  });

  return { ...result, selectedClipId: clipId };
}

/** 允许通过 `setClipProperty` 修改的路径白名单。 */
export const CLIP_PROPERTY_PATHS: readonly string[] = [
  'audio.gain',
  'audio.muted',
  'audio.fadeInMs',
  'audio.fadeOutMs',
  'transform.x',
  'transform.y',
  'transform.scale',
  'transform.rotation',
  'transform.opacity',
  'transform.fit',
  'transform.cornerRadius',
  'text.content',
  'text.fontFamily',
  'text.fontSize',
  'text.fontWeight',
  'text.fontStyle',
  'text.color',
  'text.strokeColor',
  'text.strokeWidth',
  'text.backgroundColor',
  'text.lineHeight',
  'text.letterSpacing',
  'text.align',
  'text.verticalAlign',
  'label',
  'isOverlay',
  'zIndex',
];

/** 数值型属性的取值范围钳制。 */
// 数值范围表与钳制逻辑已抽到 `valueRanges.ts`（FR-064），
// 由 `setClipProperty`（编辑路径）与 `deserialize`（导入路径）**共用同一份**。
// 这样新增受约束字段只需改一处，两条路径同时生效。

/**
 * 设置 clip 属性（路径白名单，防止越权写入）。
 */
export function setClipProperty(
  ctx: OperationContext,
  clipId: string,
  path: string,
  value: unknown,
): OperationResult {
  const located = ctx.doc.tracks
    .map((track) => ({ track, clip: track.clips.find((item) => item.id === clipId) }))
    .find((entry) => entry.clip);
  if (!located || !located.clip) throw new ClipNotFoundError(clipId);
  if (located.track.locked) throw new InvalidOperationError(`轨道已锁定：${located.track.name}`);

  if (!CLIP_PROPERTY_PATHS.includes(path)) {
    throw new InvalidOperationError(`不允许修改的属性路径：${path}`);
  }

  let nextValue = value;
  if (typeof value === 'number') {
    nextValue = clampToRange(path, value);
  }
  if (path.startsWith('text.') && !located.clip.text) {
    throw new InvalidOperationError('该 clip 没有文字属性，无法设置文字样式');
  }

  const result = run(ctx.doc, (draft) => {
    const found = locateClip(draft, clipId);
    if (!found) throw new ClipNotFoundError(clipId);
    applyProperty(found.clip as unknown as Draft<Clip>, path, nextValue);
  });

  return { ...result, selectedClipId: clipId };
}

/** 在草稿上写入一个白名单属性。 */
function applyProperty(clip: Draft<Clip>, path: string, value: unknown): void {
  const [group, key] = path.split('.');
  if (group && key) {
    const target = clip[group as 'audio' | 'transform' | 'text'];
    if (target && typeof target === 'object') {
      (target as Record<string, unknown>)[key] = value;
      return;
    }
  }
  (clip as unknown as Record<string, unknown>)[path] = value;
}

/**
 * 设置轨道标志（静音 / 隐藏 / 锁定 / 层级）。
 */
export function setTrackFlags(
  ctx: OperationContext,
  trackId: string,
  flags: Partial<Pick<Track, 'muted' | 'hidden' | 'locked' | 'order'>>,
): OperationResult {
  const track = ctx.doc.tracks.find((item) => item.id === trackId);
  if (!track) throw new TrackNotFoundError(trackId);

  const result = run(ctx.doc, (draft) => {
    const draftTarget = draftTrack(draft, trackId);
    if (!draftTarget) throw new TrackNotFoundError(trackId);
    if (flags.muted !== undefined) draftTarget.muted = flags.muted;
    if (flags.hidden !== undefined) draftTarget.hidden = flags.hidden;
    if (flags.locked !== undefined) draftTarget.locked = flags.locked;
    if (flags.order !== undefined) draftTarget.order = flags.order;
  });

  return result;
}

/**
 * 新增轨道。
 */
export function addTrack(ctx: OperationContext, input: AddTrackInput): OperationResult {
  const id = newTrackId();
  const maxOrder = ctx.doc.tracks.reduce((max, track) => Math.max(max, track.order), -1);
  const height = input.height ?? DEFAULT_TRACK_HEIGHT[input.type];

  const result = run(ctx.doc, (draft) => {
    const track: Draft<Track> = {
      id,
      type: input.type,
      name: input.name,
      order: maxOrder + 1,
      muted: false,
      hidden: false,
      locked: false,
      height,
      clips: [],
    } as Draft<Track>;

    const index = input.index;
    if (index === undefined || index < 0 || index > draft.tracks.length) {
      draft.tracks.push(track);
    } else {
      draft.tracks.splice(index, 0, track);
    }
  });

  return { ...result, selectedClipId: null };
}

/**
 * 删除轨道（连同其上的 clip）。
 */
export function removeTrack(ctx: OperationContext, trackId: string): OperationResult {
  const track = ctx.doc.tracks.find((item) => item.id === trackId);
  if (!track) throw new TrackNotFoundError(trackId);

  const result = run(ctx.doc, (draft) => {
    draft.tracks = draft.tracks.filter((item) => item.id !== trackId);
  });

  return { ...result, selectedClipId: null };
}

/**
 * 重命名 clip 备注。
 */
export function setClipLabel(ctx: OperationContext, clipId: string, label: string | null): OperationResult {
  return setClipProperty(ctx, clipId, 'label', label);
}

/** 数值钳制。 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 导出便捷函数：源区间长度。 */
export { sourceSpanMs };

// ============ 素材 / 字幕 / 设置 ============

/**
 * 新增素材（导入完成后调用）。
 */
export function addAsset(ctx: OperationContext, asset: Asset): OperationResult {
  if (ctx.doc.assets[asset.id]) {
    throw new InvalidOperationError(`素材已存在：${asset.id}`);
  }
  const result = run(ctx.doc, (draft) => {
    draft.assets[asset.id] = asset as Draft<Asset>;
  });
  return { ...result, selectedClipId: null };
}

/**
 * 更新素材属性（重命名、relink、波形等）。
 */
export function updateAsset(
  ctx: OperationContext,
  assetId: string,
  patch: Partial<Asset>,
): OperationResult {
  if (!ctx.doc.assets[assetId]) {
    throw new InvalidOperationError(`素材不存在：${assetId}`);
  }
  const result = run(ctx.doc, (draft) => {
    const asset = draft.assets[assetId];
    if (!asset) throw new InvalidOperationError(`素材不存在：${assetId}`);
    Object.assign(asset, patch);
  });
  return { ...result, selectedClipId: null };
}

/**
 * 删除素材（同时移除引用它的 clip）。
 */
export function removeAsset(ctx: OperationContext, assetId: string): OperationResult {
  if (!ctx.doc.assets[assetId]) {
    throw new InvalidOperationError(`素材不存在：${assetId}`);
  }
  const result = run(ctx.doc, (draft) => {
    delete draft.assets[assetId];
    for (const track of draft.tracks) {
      track.clips = track.clips.filter((clip) => clip.assetId !== assetId);
    }
  });
  return { ...result, selectedClipId: null };
}

/** 新增字幕条目。 */
export function addSubtitleCue(
  ctx: OperationContext,
  cue: { startMs: number; endMs: number; text: string },
): OperationResult {
  const id = newCueId();
  const result = run(ctx.doc, (draft) => {
    draft.subtitles.cues.push({
      id,
      startMs: Math.max(0, Math.round(cue.startMs)),
      endMs: Math.max(0, Math.round(cue.endMs)),
      text: cue.text,
    } as Draft<SubtitleCue>);
  });
  return { ...result, selectedClipId: null };
}

/** 更新字幕条目。 */
export function updateSubtitleCue(
  ctx: OperationContext,
  cueId: string,
  patch: { startMs?: number; endMs?: number; text?: string },
): OperationResult {
  const result = run(ctx.doc, (draft) => {
    const cue = draft.subtitles.cues.find((item) => item.id === cueId);
    if (!cue) throw new InvalidOperationError(`字幕条目不存在：${cueId}`);
    if (patch.startMs !== undefined) cue.startMs = Math.max(0, Math.round(patch.startMs));
    if (patch.endMs !== undefined) cue.endMs = Math.max(0, Math.round(patch.endMs));
    if (patch.text !== undefined) cue.text = patch.text;
  });
  return { ...result, selectedClipId: null };
}

/** 删除字幕条目。 */
export function removeSubtitleCue(ctx: OperationContext, cueId: string): OperationResult {
  const result = run(ctx.doc, (draft) => {
    draft.subtitles.cues = draft.subtitles.cues.filter((item) => item.id !== cueId);
  });
  return { ...result, selectedClipId: null };
}

/** 替换全部字幕条目（导入 SRT）。 */
export function setSubtitleCues(
  ctx: OperationContext,
  cues: ReadonlyArray<{ startMs: number; endMs: number; text: string }>,
): OperationResult {
  const result = run(ctx.doc, (draft) => {
    draft.subtitles.cues = cues.map((cue) => ({
      id: newCueId(),
      startMs: Math.max(0, Math.round(cue.startMs)),
      endMs: Math.max(0, Math.round(cue.endMs)),
      text: cue.text,
    })) as Draft<SubtitleCue>[];
  });
  return { ...result, selectedClipId: null };
}

/** 设置字幕轨开关与样式。 */
export function setSubtitleSettings(
  ctx: OperationContext,
  patch: { enabled?: boolean; style?: Partial<SubtitleStyle> },
): OperationResult {
  const result = run(ctx.doc, (draft) => {
    if (patch.enabled !== undefined) draft.subtitles.enabled = patch.enabled;
    if (patch.style) {
      Object.assign(draft.subtitles.style, patch.style);
    }
  });
  return { ...result, selectedClipId: null };
}

/** 设置画布参数。 */
export function setCanvasSettings(ctx: OperationContext, patch: Partial<CanvasSettings>): OperationResult {
  const result = run(ctx.doc, (draft) => {
    Object.assign(draft.settings.canvas, patch);
    // 数值钳制走共享约束表（FR-064），与导入路径一致。
    clampNumericValues(
      draft.settings.canvas as unknown as Record<string, unknown>,
      CANVAS_NUMERIC_RANGES,
    );
  });
  return { ...result, selectedClipId: null };
}

/**
 * 设置导出参数。
 *
 * `fps` 会被钳制到 `[MIN_EXPORT_FPS, MAX_EXPORT_FPS]`（D-003）：
 * 低于 10fps 时短片段会在导出离散采样时被整段丢弃（静默数据丢失）。
 */
export function setExportSettings(ctx: OperationContext, patch: Partial<ExportSettings>): OperationResult {
  const result = run(ctx.doc, (draft) => {
    Object.assign(draft.settings.export, patch);
    // 数值钳制走共享约束表（FR-064），与导入路径一致。
    clampNumericValues(
      draft.settings.export as unknown as Record<string, unknown>,
      EXPORT_NUMERIC_RANGES,
    );
  });
  return { ...result, selectedClipId: null };
}

/**
 * 修改画布尺寸。
 *
 * `transform.x/y` 按新旧宽高比换算，`text.fontSize` 按新画布高 / 1080 换算，
 * 保证视觉位置在比例变更后保持一致（PRD §4.1 / FR-026①）。
 */
export function resizeCanvas(ctx: OperationContext, width: number, height: number): OperationResult {
  const oldWidth = ctx.doc.settings.canvas.width;
  const oldHeight = ctx.doc.settings.canvas.height;
  const scaleX = oldWidth > 0 ? width / oldWidth : 1;
  const scaleY = oldHeight > 0 ? height / oldHeight : 1;
  const fontScale = height / REFERENCE_CANVAS_HEIGHT;

  const result = run(ctx.doc, (draft) => {
    draft.settings.canvas.width = width;
    draft.settings.canvas.height = height;
    for (const track of draft.tracks) {
      for (const clip of track.clips) {
        clip.transform.x = clip.transform.x * scaleX;
        clip.transform.y = clip.transform.y * scaleY;
        if (clip.text) {
          clip.text.fontSize = clip.text.fontSize * fontScale;
        }
      }
    }
  });
  return { ...result, selectedClipId: null };
}

/** 设置 AI 路由与 Provider 配置。 */
export function setAiSettings(
  ctx: OperationContext,
  patch: {
    routes?: Partial<Record<string, string | null>>;
    providers?: Record<string, ProviderConfig>;
  },
): OperationResult {
  const result = run(ctx.doc, (draft) => {
    if (patch.routes) {
      Object.assign(draft.settings.ai.routes, patch.routes);
    }
    if (patch.providers) {
      Object.assign(draft.settings.ai.providers, patch.providers);
    }
  });
  return { ...result, selectedClipId: null };
}
