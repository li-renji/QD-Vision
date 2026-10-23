/**
 * 视频元素池的 `muted` 开关测试。
 *
 * 这是「预览没有声音」的第一现场：`videoPool.acquire()` 过去硬编码
 * `video.muted = true`。该闸门一旦接上 WebAudio 就会掐断整条音频链路，
 * 因此它的默认值、逐个解除、以及「解除后新建的元素也保持解除」都必须钉住。
 */

import { describe, expect, it } from 'vitest';
import { createVideoPool } from '../videoPool.js';

describe('services/media/videoPool · muted', () => {
  it('默认新建的元素是静音的（纯画面预览的历史行为：多元素不各自出声）', () => {
    const pool = createVideoPool();

    const video = pool.acquire('a1');

    expect(video.muted).toBe(true);
    expect(pool.mutedCount).toBe(1);
  });

  it('同一素材复用同一元素（muted 状态随之保持）', () => {
    const pool = createVideoPool();

    const first = pool.acquire('a1');
    const second = pool.acquire('a1');

    expect(second).toBe(first);
    expect(pool.size).toBe(1);
  });

  it('setMuted(false, assetId) 只解除指定素材', () => {
    const pool = createVideoPool();
    const a1 = pool.acquire('a1');
    const a2 = pool.acquire('a2');

    pool.setMuted(false, 'a1');

    expect(a1.muted).toBe(false);
    // 其余元素仍保持静音 —— 否则它们会绕过混音图各自直连扬声器
    expect(a2.muted).toBe(true);
    expect(pool.mutedCount).toBe(1);
  });

  it('setMuted 全局解除后，**后续新建**的元素也是非静音（不会漏掉后建的素材）', () => {
    const pool = createVideoPool();
    const before = pool.acquire('a1');

    pool.setMuted(false);

    const after = pool.acquire('a2');
    expect(before.muted).toBe(false);
    expect(after.muted).toBe(false);
    expect(pool.mutedCount).toBe(0);
  });

  it('可以重新静音（静音轨道 / 停用预览时）', () => {
    const pool = createVideoPool();
    const video = pool.acquire('a1');
    pool.setMuted(false);
    expect(video.muted).toBe(false);

    pool.setMuted(true, 'a1');

    expect(video.muted).toBe(true);
    expect(pool.mutedCount).toBe(1);
  });

  it('对不存在的素材 setMuted 是安全的空操作', () => {
    const pool = createVideoPool();
    expect(() => pool.setMuted(false, 'never_seen')).not.toThrow();
  });

  it('初始 muted 可通过选项配置', () => {
    const pool = createVideoPool({ muted: false });

    expect(pool.acquire('a1').muted).toBe(false);
  });

  it('playAll / pauseAll 不影响 muted 状态', async () => {
    const pool = createVideoPool();
    const video = pool.acquire('a1');
    video.play = (): Promise<void> => Promise.resolve();
    video.pause = (): void => undefined;

    await pool.playAll();
    pool.pauseAll();

    expect(video.muted).toBe(true);
  });
});