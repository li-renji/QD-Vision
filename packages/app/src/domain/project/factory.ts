/**
 * 新建工程的工厂函数。
 */

import {
  APP_ID,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_AUDIO_PROPS,
  DEFAULT_CANVAS,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_TRANSFORM,
  type ClipTextProps,
  type ProjectDoc,
  type Track,
} from '@clipcut/shared-types';

/** 默认文字样式。 */
export const DEFAULT_TEXT_PROPS: ClipTextProps = {
  content: '',
  fontFamily: 'Noto Sans SC',
  fontSize: 64,
  fontWeight: 700,
  fontStyle: 'normal',
  color: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 4,
  backgroundColor: null,
  lineHeight: 1.3,
  letterSpacing: 0,
  align: 'center',
  verticalAlign: 'middle',
};

/**
 * 创建默认轨道。
 *
 * ⚠️ 按需求「不需要预设轨道」——新建工程**不再预置任何轨道**。
 * 轨道改为**按需创建**：拖入素材 / 双击素材 / 点击工具栏「+ 轨道」时，
 * 由 `addClipToAutoTrack`（拖入）或 `addTrack`（手动）生成兼容轨道。
 *
 * 保留此函数作为「未来模板化默认轨道」的扩展点；当前直接返回空数组。
 */
export function createDefaultTracks(): Track[] {
  return [];
}

/**
 * 创建一个空工程。
 */
export function createEmptyProject(name = '未命名工程', now: Date = new Date()): ProjectDoc {
  const iso = now.toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projectId: '',
    name,
    createdAt: iso,
    updatedAt: iso,
    generator: { app: APP_ID, version: CURRENT_SCHEMA_VERSION },
    settings: {
      canvas: { ...DEFAULT_CANVAS },
      export: { ...DEFAULT_EXPORT_SETTINGS },
      ai: { routes: {}, providers: {} },
    },
    assets: {},
    tracks: createDefaultTracks(),
    subtitles: {
      enabled: false,
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: [],
    },
    meta: {
      durationMs: 0,
      lastExport: null,
    },
  };
}

/** 供其它模块复用的缺省值。 */
export { DEFAULT_TRANSFORM, DEFAULT_AUDIO_PROPS };
