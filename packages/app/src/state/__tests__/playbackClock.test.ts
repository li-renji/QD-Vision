/**
 * 播放时钟测试（播放头不动的根因修复）。
 *
 * 用**完全可控的假时钟**（手写 rAF 队列 + 手写 `now()`）驱动，因此：
 * - 无需真实时间，断言可以精确到毫秒；
 * - 「播放 1 秒后时间推进约 1000ms」这类需求可以被严格验证。
 *
 * 覆盖：
 * 1. 播放推进（真实经过时间 × 倍速）
 * 2. 暂停后停止推进
 * 3. 到达工程末尾自动停止并钳位
 * 4. seek 重置基准（不被时钟拽回旧位置）
 * 5. 变速不跳变
 * 6. 单帧 delta 上限（标签页切回不瞬移）
 * 7. 幂等 start / stop
 */

import { describe, expect, it } from 'vitest';
import { MAX_CLOCK_DELTA_MS, createPlaybackClock, type PlaybackClock } from '../playbackClock.js';

/** 假时钟测试夹具。 */
interface Harness {
  clock: PlaybackClock;
  /** 当前时间线位置（毫秒）。 */
  timeMs: number;
  /** 当前真实时间（毫秒）。 */
  perfMs: number;
  /** 当前倍速。 */
  rate: number;
  /** 工程总时长（毫秒）。 */
  durationMs: number;
  /** 自动停止次数。 */
  stoppedCount: number;
  /** 推进真实时间 `deltaMs`，并驱动一帧。 */
  advance: (deltaMs: number) => void;
  /** 连续推进 `steps` 帧，每帧 `stepMs`。 */
  advanceFrames: (steps: number, stepMs: number) => void;
  /** 模拟外部 seek（直接改时间，**不**通知时钟）。 */
  externalSeek: (ms: number) => void;
  /** 当前是否已排入下一帧。 */
  pendingFrames: () => number;
}

/** 创建一个由假 rAF 队列驱动的播放时钟。 */
function createHarness(init?: {
  durationMs?: number;
  rate?: number;
  timeMs?: number;
  maxDeltaMs?: number;
  /** `setTimeMs` 是否像生产 store 一样调用 `rebase()`（默认 true）。 */
  rebaseOnWrite?: boolean;
}): Harness {
  let timeMs = init?.timeMs ?? 0;
  let perfMs = 0;
  let rate = init?.rate ?? 1;
  const durationMs = init?.durationMs ?? 0;
  let stoppedCount = 0;
  /** 手写 rAF 队列。 */
  const queue: Array<() => void> = [];

  const clock = createPlaybackClock({
    getTimeMs: () => timeMs,
    setTimeMs: (ms) => {
      timeMs = Math.max(0, ms);
      // 与真实 store 的**内部通道**一致：时钟自身写回不触发 rebase
      if (init?.rebaseOnWrite ?? false) clock.rebase();
    },
    getPlaybackRate: () => rate,
    getDurationMs: () => durationMs,
    onStopped: () => {
      stoppedCount += 1;
    },
    now: () => perfMs,
    requestFrame: (callback) => {
      queue.push(callback);
      return queue.length;
    },
    cancelFrame: () => {
      queue.length = 0;
    },
    ...(init?.maxDeltaMs !== undefined ? { maxDeltaMs: init.maxDeltaMs } : {}),
  });

  const advance = (deltaMs: number): void => {
    perfMs += deltaMs;
    const pending = queue.splice(0, queue.length);
    for (const callback of pending) callback();
  };

  const harness: Harness = {
    clock,
    get timeMs() {
      return timeMs;
    },
    set timeMs(value: number) {
      timeMs = value;
    },
    get perfMs() {
      return perfMs;
    },
    set perfMs(value: number) {
      perfMs = value;
    },
    get rate() {
      return rate;
    },
    set rate(value: number) {
      rate = value;
    },
    durationMs,
    get stoppedCount() {
      return stoppedCount;
    },
    advance,
    advanceFrames: (steps, stepMs) => {
      for (let index = 0; index < steps; index += 1) advance(stepMs);
    },
    externalSeek: (ms) => {
      timeMs = ms;
    },
    pendingFrames: () => queue.length,
  };

  return harness;
}

describe('state/playbackClock', () => {
  /**
   * 回归防护：曾被怀疑「时钟自己写入 → 触发 rebase → delta 被自己吃掉 → 卡死在第一帧」。
   *
   * 本文件的 harness 默认**不** rebase（与生产 store 的内部通道一致）。
   *
   * 关于「rebase 会不会吃掉 delta」的准确结论：`rebase()` 记录的是一对自洽坐标
   * `(anchorTimeMs, anchorPerfMs) = (刚写入的时间, 写入那一刻的真实时间)`。
   * 下一帧 rAF 触发时 `now()` 已经比写入时刻**晚了整整一帧**（约 16ms），
   * 所以 delta ≈ 16ms 而不是 0 —— rebase 本身不会造成冻结。
   * 但时钟既然已经自持基准，就不需要 rebase 参与，故生产走 `rebase:false`，
   * 让「谁负责维护锚点」这件事只有一处。
   */
  it('时钟自持基准（写入路径不 rebase）：逐帧严格递增，不会卡在第一帧', () => {
    const h = createHarness({ durationMs: 600_000, rebaseOnWrite: false });
    h.clock.start();

    const samples: number[] = [];
    for (let frame = 0; frame < 10; frame += 1) {
      h.advance(16);
      samples.push(h.timeMs);
    }

    // 若锚点没推进，第二帧起就会永远停在 16
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1] ?? 0);
    }
    // 10 帧 × 16ms = 160ms
    expect(samples[samples.length - 1]).toBeGreaterThan(150);
    expect(samples[0]).toBe(16);
  });

  /**
   * 回归防护：时钟**不得依赖**外部 `rebase()` 才能推进。
   *
   * 历史隐患：早期实现里 `anchorTimeMs` 只由 `rebase()` 更新，一旦
   * `setCurrentTime` 没有调用 `rebase()`，`anchorTimeMs` 就永远停在 0，
   * 时钟**卡死在第一帧**（≈16ms → 30fps 时间码显示 `00:00:00:00`，
   * 肉眼看就是「播放头完全不动」）。
   *
   * 现在 `tick()` 自己也会把 `anchorTimeMs` 推进到 `nextMs`，
   * 因此即使写入路径完全不 rebase，时钟依旧正常前进。
   */
  it('即使写入路径不调用 rebase，时钟仍能自持推进（不会卡在第一帧）', () => {
    const h = createHarness({ durationMs: 600_000, rebaseOnWrite: false });
    h.clock.start();

    const samples: number[] = [];
    for (let frame = 0; frame < 8; frame += 1) {
      h.advance(16);
      samples.push(h.timeMs);
    }

    // 8 帧 × 16ms = 128ms。若依赖外部 rebase，这里会恒为 16
    expect(samples[samples.length - 1]).toBe(128);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1] ?? 0);
    }
  });

  it('不依赖外部 rebase 时，外部 seek 依然生效（rebase 是唯一的 seek 入口）', () => {
    const h = createHarness({ durationMs: 60_000, rebaseOnWrite: false });
    h.clock.start();
    h.advanceFrames(5, 16);

    // 模拟拖动播放头：改值 + 显式 rebase（与 store 的 setCurrentTime 一致）
    h.timeMs = 5000;
    h.clock.rebase();
    h.advanceFrames(5, 16);

    expect(h.timeMs).toBeGreaterThan(5000);
    expect(h.timeMs).toBeLessThan(5100);
  });

  it('播放中按真实经过时间推进 currentTimeMs（1 秒 ≈ 1000ms）', () => {
    const h = createHarness({ durationMs: 60_000 });
    h.clock.start();

    // 60fps × 60 帧 = 1 秒真实时间
    h.advanceFrames(60, 1000 / 60);

    expect(h.timeMs).toBeGreaterThan(950);
    expect(h.timeMs).toBeLessThan(1050);
    expect(h.clock.running).toBe(true);
  });

  it('推进量随 playbackRate 线性放大', () => {
    const h = createHarness({ durationMs: 600_000, rate: 2 });
    h.clock.start();
    h.advanceFrames(60, 1000 / 60);

    // 2 倍速 → 约 2000ms
    expect(h.timeMs).toBeGreaterThan(1900);
    expect(h.timeMs).toBeLessThan(2100);
  });

  it('暂停（stop）后时间不再推进', () => {
    const h = createHarness({ durationMs: 60_000 });
    h.clock.start();
    h.advanceFrames(10, 16);
    const atPause = h.timeMs;
    expect(atPause).toBeGreaterThan(0);

    h.clock.stop();
    h.advanceFrames(60, 16);

    expect(h.timeMs).toBe(atPause);
    expect(h.clock.running).toBe(false);
  });

  it('到达工程总时长时自动停止并把时间钳到末尾', () => {
    const h = createHarness({ durationMs: 500 });
    h.clock.start();

    // 一帧就跨过末尾
    h.advanceFrames(30, 100);

    expect(h.timeMs).toBe(500);
    expect(h.clock.running).toBe(false);
    expect(h.stoppedCount).toBe(1);
    // 停止后不再排帧，也不自动循环
    expect(h.pendingFrames()).toBe(0);
    h.advanceFrames(60, 100);
    expect(h.timeMs).toBe(500);
    expect(h.stoppedCount).toBe(1);
  });

  it('倒放（负倍速）到 0 时自动停止并钳位到 0', () => {
    const h = createHarness({ durationMs: 5000, rate: -1, timeMs: 300 });
    h.clock.start();
    h.advanceFrames(30, 100);

    expect(h.timeMs).toBe(0);
    expect(h.clock.running).toBe(false);
    expect(h.stoppedCount).toBe(1);
  });

  it('总时长未知（0）时不自动停止', () => {
    const h = createHarness({ durationMs: 0 });
    h.clock.start();
    h.advanceFrames(120, 16);

    expect(h.clock.running).toBe(true);
    expect(h.stoppedCount).toBe(0);
    expect(h.timeMs).toBeGreaterThan(0);
  });

  /**
   * 空工程场景（durationMs = 0）。
   *
   * 这是用户新建工程后第一次点播放时会走的路径 —— 曾经被怀疑在这里
   * 时钟会冻结。断言两件事：
   * 1. `hitEnd` 因`durationMs > 0` 为假而**不触发**，时钟不会自停；
   * 2. 时间仍按真实经过时间推进，且**严格大于一帧**（排除「卡在 16ms」）。
   */
  it('空工程（durationMs=0）：时钟照常推进，且推进量与真实时间成正比', () => {
    const h = createHarness({ durationMs: 0 });
    h.clock.start();

    // 60fps × 60 帧 = 1000ms 真实时间
    h.advanceFrames(60, 1000 / 60);

    // ±20% 容差：任何「delta 被吃掉」的回归都会立刻暴露
    const expected = 1000;
    expect(h.timeMs).toBeGreaterThan(expected * 0.8);
    expect(h.timeMs).toBeLessThan(expected * 1.2);
    // 关键：必须远大于第一帧（16ms），排除冻结
    expect(h.timeMs).toBeGreaterThan(100);
    expect(h.clock.running).toBe(true);
  });

  it('空工程下推进量随时间线性增长（累计 1s / 3s / 6s 真实时间）', () => {
    const h = createHarness({ durationMs: 0 });
    h.clock.start();

    /** 追加推进 `seconds` 秒真实时间，返回累计的 timeMs。 */
    const at = (seconds: number): number => {
      h.advanceFrames(Math.round(60 * seconds), 1000 / 60);
      return h.timeMs;
    };

    // 注意是**累计**值：1s → 1000ms；再推进 2s → 累计 3000ms；再 3s → 累计 6000ms
    const t1 = at(1);
    const t2 = at(2);
    const t3 = at(3);

    for (const [actual, expected] of [
      [t1, 1000],
      [t2, 3000],
      [t3, 6000],
    ] as const) {
      expect(actual).toBeGreaterThan(expected * 0.8);
      expect(actual).toBeLessThan(expected * 1.2);
    }
  });

  it('seek 后时钟从新位置继续，不会把用户拖到的位置覆盖掉', () => {
    const h = createHarness({ durationMs: 60_000 });
    h.clock.start();
    h.advanceFrames(10, 16);
    expect(h.timeMs).toBeGreaterThan(0);

    // 用户拖动播放头到 5000ms，并重置基准（= store 的 setCurrentTime 行为）
    h.timeMs = 5000;
    h.clock.rebase();
    h.advanceFrames(10, 16);

    // 时间必须从 5000 附近继续，而不是回到旧锚点算出的 ~160ms
    expect(h.timeMs).toBeGreaterThan(5000);
    expect(h.timeMs).toBeLessThan(5200);
  });

  it('seek 后不 rebase 会被旧锚点覆盖 —— 反证上面的保护是必要的', () => {
    const h = createHarness({ durationMs: 60_000 });
    h.clock.start();
    h.advanceFrames(10, 16);

    // 只改时间、不 rebase（模拟「忘记重置基准」的实现）
    h.externalSeek(5000);
    h.advanceFrames(10, 16);

    // 旧锚点仍在 ~160ms 处，于是时间被拽回去了 → 这就是 bug 本身
    expect(h.timeMs).toBeLessThan(1000);
  });

  it('变速时不产生跳变（时间连续）', () => {
    const h = createHarness({ durationMs: 600_000 });
    h.clock.start();
    h.advanceFrames(30, 1000 / 60);
    const before = h.timeMs;
    expect(before).toBeGreaterThan(400);
    expect(before).toBeLessThan(600);

    // 切到 4 倍速并重置基准
    h.rate = 4;
    h.clock.rebase();

    // 切换后的第一帧：只应推进一个真实帧的量（16.7ms × 4 ≈ 67ms），绝不跳 4 倍
    h.advance(1000 / 60);
    const afterOneFrame = h.timeMs;
    expect(afterOneFrame - before).toBeLessThan(100);

    // 之后按 4 倍速稳定推进：60 帧 × 16.7ms = 1000ms 真实时间 → ≈ 4000ms
    h.advanceFrames(60, 1000 / 60);
    expect(h.timeMs - afterOneFrame).toBeGreaterThan(3800);
    expect(h.timeMs - afterOneFrame).toBeLessThan(4200);
  });

  it('单帧 delta 超过上限时只推进上限（标签页切回不瞬移到片尾）', () => {
    const h = createHarness({ durationMs: 600_000 });
    h.clock.start();

    // 标签页被挂起 30 秒后回到前台
    h.advance(30_000);

    expect(h.timeMs).toBe(MAX_CLOCK_DELTA_MS);
    expect(h.clock.running).toBe(true);
  });

  it('真实时间没有前进时不写回时间（暂停态空转不产生无谓更新）', () => {
    const h = createHarness({ durationMs: 60_000 });
    h.clock.start();
    h.advanceFrames(5, 16);
    const snapshot = h.timeMs;

    // delta = 0 的帧
    h.advance(0);
    expect(h.timeMs).toBe(snapshot);

    // 负delta（系统时钟被回拨）也不能让时间倒退
    h.advance(-1000);
    expect(h.timeMs).toBe(snapshot);
  });

  it('start / stop 幂等：重复调用不会产生并行循环', () => {
    const h = createHarness({ durationMs: 60_000 });
    h.clock.start();
    h.clock.start();
    expect(h.pendingFrames()).toBe(1);

    h.clock.stop();
    h.clock.stop();
    expect(h.pendingFrames()).toBe(0);
    expect(h.clock.running).toBe(false);
  });

  it('dispose 等价于 stop', () => {
    const h = createHarness({ durationMs: 60_000 });
    h.clock.start();
    h.advanceFrames(5, 16);
    h.clock.dispose();

    expect(h.clock.running).toBe(false);
    const snapshot = h.timeMs;
    h.advanceFrames(30, 16);
    expect(h.timeMs).toBe(snapshot);
  });

  it('手动 tick 可在无rAF 环境推进（降级驱动路径）', () => {
    const h = createHarness({ durationMs: 60_000 });
    h.clock.start();
    // 清空 rAF 队列，模拟 requestAnimationFrame 被禁用
    h.advance(0);

    h.perfMs += 100;
    h.clock.tick();
    expect(h.timeMs).toBeGreaterThan(0);
  });
});