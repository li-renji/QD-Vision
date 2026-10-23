/**
 * 播放时钟 —— `currentTimeMs` 的**唯一推进者**。
 *
 * ## 为什么需要它
 *
 * `playbackStore.play()` 过去只做 `set({ isPlaying: true })`：全仓库**没有任何代码**
 * 在播放时推进 `currentTimeMs`，于是「播放头不动、预览画面全黑」。
 * 本模块用 `requestAnimationFrame` 把**真实经过时间**换算成时间线位置，补齐这条缺失。
 *
 * ## 关键设计
 *
 * 1. **锚点式推进**（anchor / rebase）：时钟持有 `(anchorTimeMs, anchorPerfMs)`，
 *    每次推进 `next = anchorTimeMs + (now - anchorPerfMs) * playbackRate`。
 *    `rebase()` 把锚点重置到「当前时间 + 当前 performance.now()」，因此：
 *    - **seek**（`setCurrentTime`）→ 重置基准 → 用户拖到哪就从哪继续，不会被时钟拽回去；
 *    - **变速**（`setPlaybackRate`）→ 重置基准 → 时间连续，不会跳变。
 * 2. **不持有 React**：时钟只通过回调读写 store，`currentTimeMs` 依旧走
 *    `setCurrentTime` → `frameListeners`（`subscribeFrame` 命令式通道），
 *    **不引入任何新的渲染路径**。
 * 3. **到末尾自动停**：`next >= durationMs` 时钳到末尾、停 rAF、回调 `onStopped`，
 *    播完即停（不循环）。
 * 4. **单帧推进上限**：标签页切回前台时 `delta` 可能高达数十秒，
 *    超过 `MAX_CLOCK_DELTA_MS` 的部分直接丢弃，避免画面瞬间跳到片尾。
 *
 * 本模块**不 import 任何 store**，依赖全部由 `createPlaybackClock()` 注入，
 * 因此可以完全用假时钟做单元测试。
 */

/** 单帧最大真实推进量（毫秒）—— 超出部分视为「标签页曾被挂起」，直接丢弃。 */
export const MAX_CLOCK_DELTA_MS = 250;

/** 播放时钟参数。 */
export interface PlaybackClockOptions {
  /** 读取当前时间线位置（毫秒）。 */
  getTimeMs: () => number;
  /** 写回时间线位置（毫秒）—— 由调用方转发到 `playbackStore.setCurrentTime`。 */
  setTimeMs: (ms: number) => void;
  /** 读取播放倍速（1 = 正常，负数 = 倒放）。 */
  getPlaybackRate: () => number;
  /** 读取工程总时长（毫秒）；`<= 0` 表示未知长度，此时不做自动停止。 */
  getDurationMs: () => number;
  /** 播放到边界（末尾 / 倒放到头）并自动停止时触发。 */
  onStopped?: () => void;
  /** 真实时间源（毫秒，默认 `performance.now()`）。 */
  now?: () => number;
  /** 帧调度（默认 `window.requestAnimationFrame`）。 */
  requestFrame?: (callback: () => void) => number;
  /** 取消帧调度（默认 `window.cancelAnimationFrame`）。 */
  cancelFrame?: (handle: number) => void;
  /** 单帧推进上限（默认 {@link MAX_CLOCK_DELTA_MS}）。 */
  maxDeltaMs?: number;
}

/** 播放时钟实例。 */
export interface PlaybackClock {
  /** 启动 rAF 循环（幂等）。 */
  start(): void;
  /** 停止 rAF 循环（幂等）。 */
  stop(): void;
  /**
   * 重置时间基准。
   *
   * 必须在**外部**改写 `currentTimeMs`（seek / 逐帧 / 变速）之后调用，
   * 否则时钟会用旧锚点把用户的位置覆盖掉。
   */
  rebase(): void;
  /** 手动推进一帧（测试与降级驱动用；正常路径由 rAF 自行调度）。 */
  tick(): void;
  /** rAF 循环是否在运行。 */
  readonly running: boolean;
  /** 停止并释放（等价于 `stop()`）。 */
  dispose(): void;
}

/**
 * 创建播放时钟。
 *
 * @param options 依赖注入（时间源 / 帧调度可替换，便于测试）
 */
export function createPlaybackClock(options: PlaybackClockOptions): PlaybackClock {
  const now = options.now ?? ((): number => performance.now());
  const requestFrame =
    options.requestFrame ??
    ((callback: () => void): number => window.requestAnimationFrame(() => callback()));
  const cancelFrame =
    options.cancelFrame ??
    ((handle: number): void => {
      window.cancelAnimationFrame(handle);
    });
  const maxDeltaMs = options.maxDeltaMs ?? MAX_CLOCK_DELTA_MS;

  /** 时间线位置锚点（毫秒）。 */
  let anchorTimeMs = options.getTimeMs();
  /** 真实时间锚点（毫秒）。 */
  let anchorPerfMs = now();
  /** 是否正在跑 rAF。 */
  let running = false;
  /** 当前 rAF handle。 */
  let rafHandle = 0;

  const rebase = (): void => {
    anchorTimeMs = options.getTimeMs();
    anchorPerfMs = now();
  };

  const schedule = (): void => {
    rafHandle = requestFrame(tick);
  };

  function tick(): void {
    if (!running) return;

    const perfNowMs = now();
    // 时钟回退保护（系统时间被调整 / 测试注入异常值）
    const rawDeltaMs = perfNowMs - anchorPerfMs;
    const deltaMs = Math.min(Math.max(rawDeltaMs, 0), maxDeltaMs);
    anchorPerfMs = perfNowMs;

    // 本帧没有真实时间流逝：只续期，不写回（避免无谓的重渲染 / 通知）
    if (deltaMs <= 0) {
      schedule();
      return;
    }

    const rate = options.getPlaybackRate();
    const durationMs = options.getDurationMs();
    let nextMs = anchorTimeMs + deltaMs * rate;

    // 到边界：钳位 + 自动停止（不循环）
    const hitEnd = durationMs > 0 && rate >= 0 && nextMs >= durationMs;
    const hitStart = rate < 0 && nextMs <= 0;
    const hitBoundary = hitEnd || hitStart;
    if (hitEnd) nextMs = durationMs;
    else if (hitStart) nextMs = 0;

    // **自持基准**：先把锚点推进到本帧算出的值，再写回。
    //
    // 这一步让时钟**不依赖**外部是否调用 `rebase()`：
    // - 有 rebase（生产接线）：`setTimeMs` 之后 anchorTimeMs 被置为同一个 nextMs，无冲突；
    // - 无 rebase：anchorTimeMs 仍由这里推进，时钟照样正常前进。
    //
    // 否则一旦 `setCurrentTime` 不再 rebase，anchorTimeMs 会永远停在 0，
    // 时钟将**卡死在第一帧**（≈16ms，显示为 `00:00:00:00`）。
    // 外部 seek 依然通过 `rebase()` 把锚点拉到用户拖到的位置。
    anchorTimeMs = nextMs;
    options.setTimeMs(nextMs);

    if (hitBoundary) {
      running = false;
      cancelFrame(rafHandle);
      options.onStopped?.();
      return;
    }

    schedule();
  }

  const start = (): void => {
    if (running) return;
    running = true;
    rebase();
    schedule();
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    cancelFrame(rafHandle);
  };

  return {
    start,
    stop,
    rebase,
    tick,
    get running(): boolean {
      return running;
    },
    dispose: stop,
  };
}