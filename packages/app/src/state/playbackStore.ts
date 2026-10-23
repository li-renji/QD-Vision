/**
 * 播放状态（`currentTimeMs` / `isPlaying` / `playbackRate`）。
 *
 * 关键设计：`currentTimeMs` 是 **60Hz 高频**状态，**绝不能**放在会触发
 * 组件树重渲染的路径上。因此本 store 提供 `subscribeFrame()` 命令式通道：
 * 渲染循环与播放头直接读 ref，不触发 React 重渲染。
 * 需要显示时间码的地方以 10Hz 节流订阅。
 */

import { create } from 'zustand';

/** 播放状态。 */
export interface PlaybackState {
  /** 当前播放位置（毫秒） */
  currentTimeMs: number;
  isPlaying: boolean;
  /** 播放倍速（1 = 正常，J/K/L 调整） */
  playbackRate: number;
  /** 逐帧步进精度（毫秒），由画布 fps 决定 */
  frameDurationMs: number;

  setCurrentTime: (ms: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setFrameDuration: (ms: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** 逐帧步进（正数前进，负数后退）。 */
  stepFrame: (direction: 1 | -1) => void;
  /** 跳到开头 / 结尾。 */
  seekToStart: (durationMs: number) => void;
  seekToEnd: (durationMs: number) => void;
  /** 注册命令式帧回调；返回取消订阅函数。 */
  subscribeFrame: (callback: (timeMs: number) => void) => () => void;
}

/** 命令式回调集合（不参与 React 渲染）。 */
const frameListeners = new Set<(timeMs: number) => void>();

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  currentTimeMs: 0,
  isPlaying: false,
  playbackRate: 1,
  frameDurationMs: 1000 / 30,

  setCurrentTime: (ms) => {
    set({ currentTimeMs: Math.max(0, ms) });
    for (const listener of frameListeners) listener(Math.max(0, ms));
  },

  setIsPlaying: (playing) => {
    set({ isPlaying: playing });
  },

  setPlaybackRate: (rate) => {
    set({ playbackRate: rate });
  },

  setFrameDuration: (ms) => {
    set({ frameDurationMs: ms > 0 ? ms : 1000 / 30 });
  },

  play: () => {
    set({ isPlaying: true });
  },

  pause: () => {
    set({ isPlaying: false });
  },

  togglePlay: () => {
    set({ isPlaying: !get().isPlaying });
  },

  stepFrame: (direction) => {
    const { currentTimeMs, frameDurationMs } = get();
    get().setCurrentTime(currentTimeMs + direction * frameDurationMs);
  },

  seekToStart: () => {
    get().setCurrentTime(0);
  },

  seekToEnd: (durationMs) => {
    get().setCurrentTime(Math.max(0, durationMs));
  },

  subscribeFrame: (callback) => {
    frameListeners.add(callback);
    return () => {
      frameListeners.delete(callback);
    };
  },
}));

/** 便捷读取：当前播放位置（命令式）。 */
export function getCurrentTimeMs(): number {
  return usePlaybackStore.getState().currentTimeMs;
}

/** 便捷读取：是否正在播放（命令式）。 */
export function isPlaying(): boolean {
  return usePlaybackStore.getState().isPlaying;
}
