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
import { trackId as newTrackId } from '../../utils/id.js';

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
 * 创建默认轨道：2 视频 + 2 音频 + 1 文字。
 *
 * `order` 递增：数值大者在上层。
 */
export function createDefaultTracks(): Track[] {
  const tracks: Track[] = [];
  const names = {
    video: ['视频轨 1', '视频轨 2'],
    audio: ['音频轨 1', '音频轨 2'],
    text: ['文字轨'],
  } as const;

  let order = 0;
  for (const name of names.video) {
    tracks.push({
      id: newTrackId(),
      type: 'video',
      name,
      order: order++,
      muted: false,
      hidden: false,
      locked: false,
      height: 64,
      clips: [],
    });
  }
  for (const name of names.audio) {
    tracks.push({
      id: newTrackId(),
      type: 'audio',
      name,
      order: order++,
      muted: false,
      hidden: false,
      locked: false,
      height: 56,
      clips: [],
    });
  }
  for (const name of names.text) {
    tracks.push({
      id: newTrackId(),
      type: 'text',
      name,
      order: order++,
      muted: false,
      hidden: false,
      locked: false,
      height: 48,
      clips: [],
    });
  }
  return tracks;
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
