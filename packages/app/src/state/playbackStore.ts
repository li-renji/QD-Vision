/**
 * 播放状态（`currentTimeMs` / `isPlaying` / `playbackRate`）。
 *
 * 关键设计：`currentTimeMs` 是 **60Hz 高频**状态，**绝不能**放在会触发
 * 组件树重渲染的路径上。因此本 store 提供 `subscribeFrame()` 命令式通道：
 * 渲染循环与播放头直接读 ref，不触发 React 重渲染。
 * 需要显示时间码的地方以 10Hz 节流订阅。
 *
 * ## 播放时钟（播放头不动 / 预览全黑的根因修复）
 *
 * `play()` / `setIsPlaying(true)` 会启动 {@link PlaybackClock} —— 一个基于
 * `requestAnimationFrame` 的时钟，用**真实经过时间**（`performance.now()` 差值）
 * 乘以 `playbackRate` 推进 `currentTimeMs`，并通过 `setCurrentTime` 走既有
 * `frameListeners` 通道通知渲染层。
 *
 * 时钟采用**锚点式推进**：任何一次 `setCurrentTime`（含时钟自己的写入）都会
 * `rebase()`，因此：
 * - 拖动播放头 / 点击刻度 → 锚点立刻重置到新位置，**不会被时钟拽回旧位置**；
 * - 切换 `playbackRate` → 锚点重置，**时间连续不跳变**。
 *
 * 播放到工程总时长（或倒放到头）时**自动停止并钳位到边界**，不循环。
 */

import { create } from 'zustand';
import type { ProjectDoc } from '@clipcut/shared-types';
import { computeProjectDuration } from '../domain/project/duration.js';
import { useProjectStore } from './projectStore.js';
import { createPlaybackClock, type PlaybackClock } from './playbackClock.js';

export { MAX_CLOCK_DELTA_MS } from './playbackClock.js';

/** 播放状态。 */
export interface PlaybackState {
  /** 当前播放位置（毫秒） */
  currentTimeMs: number;
  isPlaying: boolean;
  /** 播放倍速（1 = 正常，J/K/L 调整） */
  playbackRate: number;
  /** 逐帧步进精度（毫秒），由画布 fps 决定 */
  frameDurationMs: number;

  /**
   * 写回时间线位置（毫秒，负值按 0 处理）。
   *
   * 每次写入都会 `rebase()` 把时钟锚点拉到新位置：
   * - 外部调用（seek / 逐帧 / 变速）—— 这是它**必须**重置基准的原因；
   * - 时钟自身每帧写回 —— 同样安全，见实现处注释。
   */
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

/**
 * 解析时间线总时长（毫秒）。
 *
 * **刻意不读 `doc.meta.durationMs`** —— 它是序列化/反序列化时写下的**缓存派生量**
 * （ARCHITECTURE §5.1），编辑过程中实时增删 clip 不会刷新它。若拿它当播放边界，
 * 「删掉最后一个 clip」后时钟仍会以为工程有 999 秒长，永远等不到自动停止。
 *
 * 因此这里只用 {@link computeProjectDuration}（§5.1 唯一实现处）实时计算。
 * 结果为 0 表示时间线为空，此时时钟按「长度未知」处理，不做自动停止。
 */
export function resolveTimelineDuration(doc: ProjectDoc): number {
  return computeProjectDuration(doc);
}

/** 读取当前工程总时长（毫秒）；命令式，供时钟每次推进时查询。 */
function currentDurationMs(): number {
  return resolveTimelineDuration(useProjectStore.getState().doc);
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  currentTimeMs: 0,
  isPlaying: false,
  playbackRate: 1,
  frameDurationMs: 1000 / 30,

  setCurrentTime: (ms) => {
    const clamped = Math.max(0, ms);
    set({ currentTimeMs: clamped });
    // 重置时钟基准：任何一次外部写入（seek / 逐帧 / 变速）都要把锚点拉到
    // 用户刚操作到的位置，否则时钟会用旧锚点把它覆盖掉。
    //
    // 时钟自身每帧写回**也**走这里，这是安全的：`set()` 先于 `rebase()` 执行，
    // 所以 rebase 读到的是刚写入的新值，`anchorTimeMs` 不会被置回旧值；
    // 而 `anchorPerfMs` 虽被重置为「写回那一刻」，下一帧的 delta 依然是
    // 两次 rAF 之间的真实间隔（约 16ms）。逐帧轨迹见 playbackClock 的
    // 「时钟自持基准」用例。
    clock.rebase();
    for (const listener of frameListeners) listener(clamped);
  },

  setIsPlaying: (playing) => {
    set({ isPlaying: playing });
    if (playing) clock.start();
    else clock.stop();
  },

  setPlaybackRate: (rate) => {
    set({ playbackRate: rate });
    // 重置基准：变速前 accrued 的那一点点 delta 不应被新倍速二次放大
    clock.rebase();
  },

  setFrameDuration: (ms) => {
    set({ frameDurationMs: ms > 0 ? ms : 1000 / 30 });
  },

  play: () => {
    const { currentTimeMs } = get();
    // 已在片尾时按播放 = 从头重放（否则「播放」看起来毫无反应）
    const durationMs = currentDurationMs();
    if (durationMs > 0 && currentTimeMs >= durationMs) {
      get().setCurrentTime(0);
    }
    set({ isPlaying: true });
    clock.start();
  },

  pause: () => {
    clock.stop();
    set({ isPlaying: false });
  },

  togglePlay: () => {
    if (get().isPlaying) get().pause();
    else get().play();
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

/**
 * 播放时钟单例。
 *
 * 依赖全部来自本模块内的 store，因此它在**任何组件挂载之前**就可用 ——
 * 播放不依赖 `PreviewCanvas` 是否渲染。
 */
const clock: PlaybackClock = createPlaybackClock({
  getTimeMs: () => usePlaybackStore.getState().currentTimeMs,
  setTimeMs: (ms) => {
    // 走公开入口：setCurrentTime 内部会 rebase，对时钟自身写回同样安全
    usePlaybackStore.getState().setCurrentTime(ms);
  },
  getPlaybackRate: () => usePlaybackStore.getState().playbackRate,
  getDurationMs: currentDurationMs,
  onStopped: () => {
    usePlaybackStore.setState({ isPlaying: false });
  },
});

/** 取得播放时钟单例（测试与降级驱动用）。 */
export function getPlaybackClock(): PlaybackClock {
  return clock;
}

/** 便捷读取：当前播放位置（命令式）。 */
export function getCurrentTimeMs(): number {
  return usePlaybackStore.getState().currentTimeMs;
}

/** 便捷读取：是否正在播放（命令式）。 */
export function isPlaying(): boolean {
  return usePlaybackStore.getState().isPlaying;
}