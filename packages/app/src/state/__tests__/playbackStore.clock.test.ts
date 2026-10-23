/**
 * 播放 store 与时钟的集成测试（用户实测「点播放指针不动」的回归防护）。
 *
 * 与 `playbackClock.test.ts` 的区别：这里驱动的是**真实的 `usePlaybackStore` 单例**
 * 与**真实的单例时钟**，验证「点播放 → `currentTimeMs`真的推进 →
 * `frameListeners`（`subscribeFrame` 通道）真的收到通知」这条完整链路。
 *
 * 时间源被替换为可控假时钟，因此断言精确、无需真实等待。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDoc } from '@clipcut/shared-types';
import { deserialize } from '../../domain/project/deserialize.js';
import { readFixtureJson } from '../../test/fixtures.js';
import { useProjectStore } from '../projectStore.js';
import {
  MAX_CLOCK_DELTA_MS,
  getCurrentTimeMs,
  getPlaybackClock,
  resolveTimelineDuration,
  usePlaybackStore,
} from '../playbackStore.js';

/** 手写 rAF 队列 + 假`performance.now()`。 */
interface FakeRaf {
  /** 推进真实时间并驱动所有待执行帧（单帧）。 */
  advance: (deltaMs: number) => void;
  /** 按 `stepMs` 的节奏连续推进 `steps` 帧。 */
  advanceFrames: (steps: number, stepMs: number) => void;
  /** 待执行帧数。 */
  pending: () => number;
  restore: () => void;
}

/** 安装可控的 rAF / performance.now。 */
function installFakeRaf(): FakeRaf {
  let perfMs = 0;
  const queue: Array<FrameRequestCallback> = [];

  const rafSpy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback: FrameRequestCallback): number => {
      queue.push(callback);
      return queue.length;
    });
  const cancelSpy = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((): void => {
      queue.length = 0;
    });
  const nowSpy = vi.spyOn(performance, 'now').mockImplementation((): number => perfMs);

  const advance = (deltaMs: number): void => {
    perfMs += deltaMs;
    const pending = queue.splice(0, queue.length);
    for (const callback of pending) callback(perfMs);
  };

  return {
    advance,
    advanceFrames: (steps: number, stepMs: number): void => {
      for (let index = 0; index < steps; index += 1) advance(stepMs);
    },
    pending: (): number => queue.length,
    restore: (): void => {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
      nowSpy.mockRestore();
    },
  };
}

/** 重置全部 store 到确定状态。 */
function resetStores(doc: ProjectDoc): void {
  useProjectStore.getState().setDoc(doc, { markDirty: false });
  usePlaybackStore.setState({
    currentTimeMs: 0,
    isPlaying: false,
    playbackRate: 1,
    frameDurationMs: 1000 / 30,
  });
}

describe('state/playbackStore · 播放时钟集成', () => {
  let doc: ProjectDoc;
  let raf: FakeRaf;

  beforeEach(() => {
    doc = deserialize(readFixtureJson('full.clipcut.json')).doc;
    resetStores(doc);
    raf = installFakeRaf();
  });

  afterEach(() => {
    getPlaybackClock().stop();
    raf.restore();
    usePlaybackStore.setState({ currentTimeMs: 0, isPlaying: false, playbackRate: 1 });
  });

  it('点播放后 currentTimeMs 真的推进（1 秒 ≈ 1000ms）', () => {
    usePlaybackStore.getState().play();
    expect(usePlaybackStore.getState().isPlaying).toBe(true);

    // 按真实节奏推进：60fps × 60 帧 = 1 秒真实时间
    raf.advanceFrames(60, 1000 / 60);

    expect(getCurrentTimeMs()).toBeGreaterThan(950);
    expect(getCurrentTimeMs()).toBeLessThan(1050);
  });

  it('单帧真实间隔超过上限时被钳制，不会瞬移到片尾', () => {
    const durationMs = resolveTimelineDuration(doc);
    usePlaybackStore.getState().play();

    // 标签页被挂起 30 秒后回到前台：只应推进一帧的上限量
    raf.advance(30_000);

    expect(getCurrentTimeMs()).toBe(MAX_CLOCK_DELTA_MS);
    expect(getCurrentTimeMs()).toBeLessThan(durationMs);
    expect(usePlaybackStore.getState().isPlaying).toBe(true);
  });

  it('时钟推进会通知 subscribeFrame 订阅者（渲染层的命令式通道）', () => {
    const seen: number[] = [];
    const unsubscribe = usePlaybackStore.getState().subscribeFrame((timeMs) => {
      seen.push(timeMs);
    });

    usePlaybackStore.getState().play();
    const before = seen.length;
    raf.advance(100);

    expect(seen.length).toBeGreaterThan(before);
    // 通知携带的必须是**递增**后的时间，而不是同一个值
    expect(seen[seen.length - 1]).toBeGreaterThan(0);

    unsubscribe();
    const afterUnsubscribe = seen.length;
    raf.advance(100);
    expect(seen.length).toBe(afterUnsubscribe);
  });

  it('暂停后时间停止推进', () => {
    usePlaybackStore.getState().play();
    raf.advance(500);
    const snapshot = getCurrentTimeMs();
    expect(snapshot).toBeGreaterThan(0);

    usePlaybackStore.getState().pause();
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
    raf.advance(2000);

    expect(getCurrentTimeMs()).toBe(snapshot);
  });

  it('播放到工程末尾自动停止（isPlaying 回到 false，不循环）', () => {
    const durationMs = resolveTimelineDuration(doc);
    expect(durationMs).toBeGreaterThan(0);

    usePlaybackStore.getState().setCurrentTime(durationMs - 100);
    usePlaybackStore.getState().play();
    raf.advance(1000);

    expect(getCurrentTimeMs()).toBe(durationMs);
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
    expect(raf.pending()).toBe(0);
  });

  it('在片尾按播放会从头重放（否则「播放」看起来毫无反应）', () => {
    const durationMs = resolveTimelineDuration(doc);
    usePlaybackStore.getState().setCurrentTime(durationMs);

    usePlaybackStore.getState().play();

    expect(getCurrentTimeMs()).toBe(0);
    expect(usePlaybackStore.getState().isPlaying).toBe(true);
  });

  it('播放中拖动播放头（seek）不会被时钟拽回旧位置', () => {
    usePlaybackStore.getState().play();
    raf.advance(200);
    expect(getCurrentTimeMs()).toBeGreaterThan(0);

    // 用户把播放头拖到 12s
    usePlaybackStore.getState().setCurrentTime(12_000);
    expect(getCurrentTimeMs()).toBe(12_000);

    raf.advance(200);

    // 必须从 12s 继续，而不是回到 ~200ms
    expect(getCurrentTimeMs()).toBeGreaterThan(12_000);
    expect(getCurrentTimeMs()).toBeLessThan(12_400);
  });

  it('播放中切换倍速不产生跳变', () => {
    usePlaybackStore.getState().play();
    raf.advanceFrames(60, 1000 / 60);
    const before = getCurrentTimeMs();
    expect(before).toBeGreaterThan(900);

    usePlaybackStore.getState().setPlaybackRate(4);
    // 变速瞬间时间必须保持不变
    expect(getCurrentTimeMs()).toBe(before);

    raf.advanceFrames(6, 1000 / 60);
    // 一帧只推进 16.7ms × 4 ≈ 67ms，绝不可能突然跳几秒
    expect(getCurrentTimeMs() - before).toBeLessThan(600);
    expect(getCurrentTimeMs() - before).toBeGreaterThan(300);
  });

  it('togglePlay 来回切换正确启停时钟', () => {
    usePlaybackStore.getState().togglePlay();
    expect(usePlaybackStore.getState().isPlaying).toBe(true);
    raf.advance(300);
    const playing = getCurrentTimeMs();
    expect(playing).toBeGreaterThan(0);

    usePlaybackStore.getState().togglePlay();
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
    raf.advance(1000);
    expect(getCurrentTimeMs()).toBe(playing);
  });

  it('setIsPlaying 是 play/pause 的同一条路径', () => {
    usePlaybackStore.getState().setIsPlaying(true);
    raf.advance(200);
    const advanced = getCurrentTimeMs();
    expect(advanced).toBeGreaterThan(0);

    usePlaybackStore.getState().setIsPlaying(false);
    raf.advance(1000);
    expect(getCurrentTimeMs()).toBe(advanced);
  });

  it('逐帧步进会重置基准：step 之后时钟从新位置继续', () => {
    usePlaybackStore.getState().play();
    raf.advance(200);

    usePlaybackStore.getState().stepFrame(1);
    const afterStep = getCurrentTimeMs();
    raf.advance(200);

    expect(getCurrentTimeMs()).toBeGreaterThan(afterStep);
  });

  it('resolveTimelineDuration 实时反映 clip 增删，而不是读陈旧的 meta', () => {
    const staleMetaDoc: ProjectDoc = {
      ...doc,
      // meta 缓存被改成陈旧的大值
      meta: { ...doc.meta, durationMs: 999_999 },
      // 所有 clip 被删光，且字幕 cue 也清空 → 实时时长应为 0
      tracks: doc.tracks.map((track) => ({ ...track, clips: [] })),
      subtitles: { ...doc.subtitles, cues: [] },
    };
    useProjectStore.getState().setDoc(staleMetaDoc, { markDirty: false });

    expect(resolveTimelineDuration(useProjectStore.getState().doc)).toBe(0);

    // 加回一个 3s 的 clip → 实时时长应立刻变成 3000，而不是 meta 的 999999
    const track = staleMetaDoc.tracks[0];
    expect(track).toBeDefined();
    const withClip: ProjectDoc = {
      ...staleMetaDoc,
      tracks: staleMetaDoc.tracks.map((item, index) =>
        index === 0
          ? {
              ...item,
              clips: [
                {
                  id: 'clip_probe',
                  assetId: 'asset_probe',
                  startMs: 0,
                  durationMs: 3000,
                  inMs: 0,
                  outMs: 3000,
                  speed: 1,
                  isOverlay: false,
                  zIndex: 0,
                  transform: {
                    x: 0.5,
                    y: 0.5,
                    scale: 1,
                    rotation: 0,
                    opacity: 1,
                    fit: 'contain' as const,
                    cornerRadius: 0,
                  },
                  audio: { muted: true, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
                  label: null,
                },
              ],
            }
          : item,
      ),
    };
    useProjectStore.getState().setDoc(withClip, { markDirty: false });
    expect(resolveTimelineDuration(useProjectStore.getState().doc)).toBe(3000);
  });

  it('seek 到超出范围的时间会被钳到非负', () => {
    usePlaybackStore.getState().setCurrentTime(-500);
    expect(getCurrentTimeMs()).toBe(0);
  });
});