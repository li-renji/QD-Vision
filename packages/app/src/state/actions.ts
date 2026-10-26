/**
 * 所有用户可见编辑动作的集中定义。
 *
 * 铁律：**每条动作 = 一次 `applyOperation` = 一条历史记录**（FR-059）。
 * 组件层只允许调用本文件导出的动作，不得直接改写 `projectStore.doc`。
 */

import type {
  Asset,
  ClipTextProps,
  ClipTransform,
  SubtitleStyle,
} from '@clipcut/shared-types';
import {
  addAsset as domainAddAsset,
  addClip as domainAddClip,
  addClipToAutoTrack as domainAddClipToAutoTrack,
  addSubtitleCue as domainAddSubtitleCue,
  addTextClip as domainAddTextClip,
  addTrack as domainAddTrack,
  deleteClip as domainDeleteClip,
  reorderTrack as domainReorderTrack,
  duplicateClip as domainDuplicateClip,
  extractAudio as domainExtractAudio,
  moveClip as domainMoveClip,
  removeAsset as domainRemoveAsset,
  removeSubtitleCue as domainRemoveSubtitleCue,
  removeTrack as domainRemoveTrack,
  renameTrack as domainRenameTrack,
  resizeCanvas as domainResizeCanvas,
  setAiSettings as domainSetAiSettings,
  setCanvasSettings as domainSetCanvasSettings,
  setClipProperty as domainSetClipProperty,
  setClipTransform as domainSetClipTransform,
  setClipSpeed as domainSetClipSpeed,
  setExportSettings as domainSetExportSettings,
  setSubtitleCues as domainSetSubtitleCues,
  setSubtitleSettings as domainSetSubtitleSettings,
  setTrackFlags as domainSetTrackFlags,
  splitClip as domainSplitClip,
  trimClip as domainTrimClip,
  updateAsset as domainUpdateAsset,
  updateSubtitleCue as domainUpdateSubtitleCue,
  type AddClipInput,
  type AddClipToAutoTrackInput,
  type AddTrackInput,
} from '../domain/timeline/operations.js';
import { useProjectStore } from './projectStore.js';
import { useUiStore } from './uiStore.js';
import { useHistoryStore } from './historyStore.js';
import { usePlaybackStore } from './playbackStore.js';
import { serialize } from '../domain/project/serialize.js';
import { getPlatformBridge } from '../platform/index.js';
import { saveProject as repoSaveProject } from '../services/storage/projectRepo.js';

/** 动作执行结果。 */
export interface ActionResult<T = unknown> {
  /** 是否成功。 */
  ok: boolean;
  /** 失败原因（成功时为 null）。 */
  error: string | null;
  /** 成功时的返回值。 */
  value: T | null;
}

/** 统一的异常捕获包装。 */
function run<T>(fn: () => T): ActionResult<T> {
  try {
    return { ok: true, error: null, value: fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, value: null };
  }
}

/** 在 store 中执行一次领域操作，并把结果中的选中项同步到 uiStore。 */
function apply(
  operation: Parameters<ReturnType<typeof useProjectStore.getState>['applyOperation']>[0],
): ReturnType<ReturnType<typeof useProjectStore.getState>['applyOperation']> {
  const result = useProjectStore.getState().applyOperation(operation);
  if (result.selectedClipId) {
    useUiStore.getState().setSelectedClipIds([result.selectedClipId]);
  }
  return result;
}

// ============ clip 操作 ============

/** 新增 clip。 */
export function addClip(input: AddClipInput): ActionResult<string | null> {
  return run(() => apply((ctx) => domainAddClip(ctx, input)).selectedClipId ?? null);
}

/**
 * 新增 clip，并在没有兼容轨道时自动创建一条（按需建轨）。
 *
 * 用于「双击素材 / 拖素材到空时间线」——不再强制预设轨道。
 */
export function addClipToAutoTrack(
  input: AddClipToAutoTrackInput,
): ActionResult<string | null> {
  return run(() => apply((ctx) => domainAddClipToAutoTrack(ctx, input)).selectedClipId ?? null);
}

/** 新建文字片段。 */
export function addTextClip(input: {
  trackId: string;
  startMs: number;
  durationMs: number;
  content: string;
}): ActionResult<string | null> {
  return run(() => apply((ctx) => domainAddTextClip(ctx, input)).selectedClipId ?? null);
}

/** 移动 clip。 */
export function moveClip(clipId: string, toTrackId: string, newStartMs: number): ActionResult {
  return run(() => apply((ctx) => domainMoveClip(ctx, clipId, toTrackId, newStartMs)));
}

/** 裁剪 clip。 */
export function trimClip(clipId: string, edge: 'in' | 'out', newValueMs: number): ActionResult {
  return run(() => apply((ctx) => domainTrimClip(ctx, clipId, edge, newValueMs)));
}

/** 分割 clip。 */
export function splitClip(clipId: string, atMs: number): ActionResult<string | null> {
  return run(() => apply((ctx) => domainSplitClip(ctx, clipId, atMs)).selectedClipId ?? null);
}

/** 在播放头处分割选中的 clip。 */
export function splitSelectedClip(): ActionResult<string | null> {
  const { selectedClipIds } = useUiStore.getState();
  const clipId = selectedClipIds[0];
  if (!clipId) return { ok: false, error: '没有选中的 clip', value: null };
  return splitClip(clipId, usePlaybackStore.getState().currentTimeMs);
}

/** 删除 clip。 */
export function deleteClip(clipId: string): ActionResult {
  return run(() => apply((ctx) => domainDeleteClip(ctx, clipId)));
}

/** 批量删除选中的 clip（每条 clip 各自产生一条历史记录）。 */
export function deleteSelectedClips(): ActionResult<number> {
  const { selectedClipIds } = useUiStore.getState();
  let count = 0;
  for (const clipId of selectedClipIds) {
    if (deleteClip(clipId).ok) count += 1;
  }
  useUiStore.getState().setSelectedClipIds([]);
  return { ok: count > 0, error: count > 0 ? null : '没有可删除的 clip', value: count };
}

/** 复制 clip 到指定轨道。 */
export function duplicateClip(clipId: string, toTrackId: string, atMs: number): ActionResult<string | null> {
  return run(() => apply((ctx) => domainDuplicateClip(ctx, clipId, toTrackId, atMs)).selectedClipId ?? null);
}

/** 批量复制：把剪贴板内容粘贴到当前选中轨道的播放头处。 */
export function pasteClips(): ActionResult<number> {
  const trackId = useUiStore.getState().selectedTrackIds[0];
  if (!trackId) return { ok: false, error: '请先选中一条轨道', value: null };
  if (clipboard.length === 0) return { ok: false, error: '剪贴板为空', value: null };

  const { currentTimeMs } = usePlaybackStore.getState();
  let count = 0;
  let offset = 0;
  for (const clip of clipboard) {
    const startMs = currentTimeMs + offset;
    const result =
      clip.assetId === null
        ? addTextClip({
            trackId,
            startMs,
            durationMs: clip.durationMs,
            content: typeof clip.text === 'object' && clip.text !== null
              ? String((clip.text as { content?: string }).content ?? '')
              : '',
          })
        : addClip({
            assetId: clip.assetId,
            trackId,
            startMs,
            inMs: clip.inMs,
            outMs: clip.outMs,
            speed: clip.speed,
            isOverlay: clip.isOverlay,
            label: clip.label,
          });
    if (result.ok) {
      count += 1;
      offset += clip.durationMs;
    }
  }
  return { ok: count > 0, error: count > 0 ? null : '粘贴失败', value: count };
}

/** 设置 clip 速度。 */
export function setClipSpeed(clipId: string, speed: number): ActionResult {
  return run(() => apply((ctx) => domainSetClipSpeed(ctx, clipId, speed)));
}

/** 设置 clip 属性（路径白名单）。 */
export function setClipProperty(clipId: string, path: string, value: unknown): ActionResult {
  return run(() => apply((ctx) => domainSetClipProperty(ctx, clipId, path, value)));
}

/** 批量设置选中 clip 的属性。 */
export function setClipPropertyForSelected(path: string, value: unknown): ActionResult<number> {
  const { selectedClipIds } = useUiStore.getState();
  let count = 0;
  for (const clipId of selectedClipIds) {
    if (setClipProperty(clipId, path, value).ok) count += 1;
  }
  return { ok: count > 0, error: count > 0 ? null : '没有选中的 clip', value: count };
}

/**
 * 批量设置选中 clip 的变换（位置 / 缩放 / 旋转等）。
 *
 * 画布上的手柄拖拽会调用它，按下/抬起构成一个手势 → 一次历史记录。
 * 注意：这里**每个选中 clip 各自产生一条历史记录**（保持「一次动作一条记录」铁律），
 * 而不是把所有 clip 合并成一条——这样既能在撤销时分别回滚，也避免单条 patch 跨多 clip 的复杂度。
 */
export function setClipTransformForSelected(patch: Partial<ClipTransform>): ActionResult<number> {
  const { selectedClipIds } = useUiStore.getState();
  let count = 0;
  for (const clipId of selectedClipIds) {
    if (apply((ctx) => domainSetClipTransform(ctx, clipId, patch)).selectedClipId) count += 1;
  }
  return { ok: count > 0, error: count > 0 ? null : '没有选中的 clip', value: count };
}

/** 设置文字样式（逐项写入，保证一次操作一条历史记录）。 */
export function setTextProps(clipId: string, props: Partial<ClipTextProps>): ActionResult {
  let last: ActionResult = { ok: true, error: null, value: null };
  for (const [key, value] of Object.entries(props)) {
    last = setClipProperty(clipId, `text.${key}`, value);
    if (!last.ok) break;
  }
  return last;
}

/** 批量设置**选中 clip** 的文字样式（作用于整条选中轨道的全部文字片段）。 */
export function setTextPropsForSelected(props: Partial<ClipTextProps>): ActionResult<number> {
  const { selectedClipIds } = useUiStore.getState();
  let count = 0;
  for (const clipId of selectedClipIds) {
    if (setTextProps(clipId, props).ok) count += 1;
  }
  return { ok: count > 0, error: count > 0 ? null : '没有选中的 clip', value: count };
}

// ============ 轨道操作 ============

/** 新增轨道。 */
export function addTrack(input: AddTrackInput): ActionResult {
  return run(() => apply((ctx) => domainAddTrack(ctx, input)));
}

/** 删除轨道。 */
export function removeTrack(trackId: string): ActionResult {
  return run(() => {
    const result = apply((ctx) => domainRemoveTrack(ctx, trackId));
    // 删除轨道后选中项可能引用已不存在的 clip / 轨道 → 收敛选中，避免幽灵选中。
    const doc = useProjectStore.getState().doc;
    const existing = new Set(doc.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
    useUiStore.getState().pruneSelection(existing);
    if (useUiStore.getState().selectedTrackIds.includes(trackId)) {
      useUiStore.getState().setSelectedTrackId(trackId, true);
    }
    return result;
  });
}

/** 重命名轨道。 */
export function renameTrack(trackId: string, name: string): ActionResult {
  return run(() => apply((ctx) => domainRenameTrack(ctx, trackId, name)));
}

/** 从视频轨提取音频到独立音频轨。 */
export function extractAudio(trackId: string): ActionResult<number> {
  const doc = useProjectStore.getState().doc;
  const track = doc.tracks.find((item) => item.id === trackId);
  const count = track
    ? track.clips.filter((clip) => {
        if (!clip.assetId) return false;
        const asset = doc.assets[clip.assetId];
        return !!asset?.hasAudio && !clip.audio.extracted;
      }).length
    : 0;
  const result = run(() => apply((ctx) => domainExtractAudio(ctx, trackId)));
  return { ...result, value: count };
}

/** 轨道排序：上移 / 下移（与相邻轨道交换 `order`）。 */
export function reorderTrack(trackId: string, direction: 'up' | 'down'): ActionResult {
  return run(() => apply((ctx) => domainReorderTrack(ctx, trackId, direction)));
}

/** 设置轨道标志。 */
export function setTrackFlags(
  trackId: string,
  flags: Partial<{ muted: boolean; hidden: boolean; locked: boolean; order: number }>,
): ActionResult {
  return run(() => apply((ctx) => domainSetTrackFlags(ctx, trackId, flags)));
}

// ============ 素材操作 ============

/** 新增素材。 */
export function addAsset(asset: Asset): ActionResult {
  return run(() => apply((ctx) => domainAddAsset(ctx, asset)));
}

/** 更新素材。 */
export function updateAsset(assetId: string, patch: Partial<Asset>): ActionResult {
  return run(() => apply((ctx) => domainUpdateAsset(ctx, assetId, patch)));
}

/** 删除素材。 */
export function removeAsset(assetId: string): ActionResult {
  return run(() => apply((ctx) => domainRemoveAsset(ctx, assetId)));
}

// ============ 字幕操作 ============

/** 新增字幕条目。 */
export function addSubtitleCue(cue: { startMs: number; endMs: number; text: string }): ActionResult {
  return run(() => apply((ctx) => domainAddSubtitleCue(ctx, cue)));
}

/** 更新字幕条目。 */
export function updateSubtitleCue(
  cueId: string,
  patch: { startMs?: number; endMs?: number; text?: string },
): ActionResult {
  return run(() => apply((ctx) => domainUpdateSubtitleCue(ctx, cueId, patch)));
}

/** 删除字幕条目。 */
export function removeSubtitleCue(cueId: string): ActionResult {
  return run(() => apply((ctx) => domainRemoveSubtitleCue(ctx, cueId)));
}

/** 导入 SRT（整体替换字幕条目）。 */
export function importSubtitleCues(
  cues: ReadonlyArray<{ startMs: number; endMs: number; text: string }>,
): ActionResult {
  return run(() => apply((ctx) => domainSetSubtitleCues(ctx, cues)));
}

/** 设置字幕开关与样式。 */
export function setSubtitleSettings(patch: {
  enabled?: boolean;
  style?: Partial<SubtitleStyle>;
}): ActionResult {
  return run(() => apply((ctx) => domainSetSubtitleSettings(ctx, patch)));
}

// ============ 设置操作 ============

/** 设置画布参数。 */
export function setCanvasSettings(patch: {
  width?: number;
  height?: number;
  fps?: number;
  aspectPreset?: '16:9' | '9:16' | '1:1' | '4:5' | 'custom';
  backgroundColor?: string;
}): ActionResult {
  return run(() => apply((ctx) => domainSetCanvasSettings(ctx, patch)));
}

/** 修改画布尺寸（自动换算 transform 与字号）。 */
export function resizeCanvas(width: number, height: number): ActionResult {
  return run(() => apply((ctx) => domainResizeCanvas(ctx, width, height)));
}

// ============ 工程读写操作 ============

/** 保存到本地工程库（IndexedDB）。 */
export function saveProjectNow(): ActionResult {
  const doc = useProjectStore.getState().doc;
  return run(() => {
    void repoSaveProject(doc);
    return { ok: true, error: null, value: null };
  });
}

/** 导出工程文件（下载 .clipcut.json）。 */
export function exportProjectFile(): ActionResult {
  const doc = useProjectStore.getState().doc;
  return run(() => {
    const content = serialize(doc);
    void getPlatformBridge()
      .saveFile(`${doc.name || 'project'}.clipcut.json`, new Blob([content], { type: 'application/json' }))
      .then(() => undefined)
      .catch(() => undefined);
    return { ok: true, error: null, value: null };
  });
}

/** 设置导出参数。 */
export function setExportSettings(patch: {
  format?: 'mp4' | 'webm';
  width?: number;
  height?: number;
  fps?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  burnInSubtitle?: boolean;
}): ActionResult {
  return run(() => apply((ctx) => domainSetExportSettings(ctx, patch)));
}

/** 设置 AI 路由与 Provider。 */
export function setAiSettings(patch: {
  routes?: Partial<Record<string, string | null>>;
  providers?: Record<
    string,
    { type: 'local' | 'cloud' | 'webgpu'; baseUrl: string | null; model: string | null; apiKey: string | null }
  >;
}): ActionResult {
  return run(() => apply((ctx) => domainSetAiSettings(ctx, patch)));
}

// ============ 历史操作 ============

/** 撤销。 */
export function undo(): ActionResult {
  return run(() => {
    if (!useProjectStore.getState().undo()) throw new Error('没有可撤销的操作');
    return true;
  });
}

/** 重做。 */
export function redo(): ActionResult {
  return run(() => {
    if (!useProjectStore.getState().redo()) throw new Error('没有可重做的操作');
    return true;
  });
}

/** 清空撤销栈（工程保存后调用，FR-059②）。 */
export function resetHistory(): void {
  useHistoryStore.getState().reset();
}

// ============ 剪贴板 ============

/** 剪贴板中的 clip 快照。 */
export interface ClipSnapshot {
  assetId: string | null;
  durationMs: number;
  inMs: number;
  outMs: number;
  speed: number;
  isOverlay: boolean;
  zIndex: number;
  label: string | null;
  transform: unknown;
  audio: unknown;
  text: unknown;
}

/** 模块级剪贴板（复制粘贴用）。 */
export const clipboard: ClipSnapshot[] = [];

/** 复制选中的 clip 到剪贴板（保持 `in/out/speed/transform` 不变）。 */
export function copySelectedClips(): ActionResult<number> {
  const { selectedClipIds } = useUiStore.getState();
  const doc = useProjectStore.getState().doc;
  clipboard.length = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (!selectedClipIds.includes(clip.id)) continue;
      clipboard.push({
        assetId: clip.assetId,
        durationMs: clip.durationMs,
        inMs: clip.inMs,
        outMs: clip.outMs,
        speed: clip.speed,
        isOverlay: clip.isOverlay,
        zIndex: clip.zIndex,
        label: clip.label,
        transform: { ...clip.transform },
        audio: { ...clip.audio },
        text: clip.text ? { ...clip.text } : undefined,
      });
    }
  }
  return {
    ok: clipboard.length > 0,
    error: clipboard.length > 0 ? null : '没有选中的 clip',
    value: clipboard.length,
  };
}
