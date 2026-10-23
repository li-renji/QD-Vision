import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatDurationHuman,
  formatTimecode,
  frameDurationMs,
  framesToMs,
  msToFrames,
  parseTimecode,
  roundMs,
} from '../time.js';

describe('shared-types/time', () => {
  it('msToFrames / framesToMs 互为逆运算（取整误差 ≤ 1ms）', () => {
    expect(msToFrames(1000, 30)).toBe(30);
    expect(msToFrames(0, 30)).toBe(0);
    expect(msToFrames(1234, 30)).toBe(37);
    expect(framesToMs(30, 30)).toBe(1000);
    expect(Math.abs(framesToMs(msToFrames(1234, 30), 30) - 1234)).toBeLessThanOrEqual(17);
  });

  it('非法输入返回 0 而不抛异常', () => {
    expect(msToFrames(Number.NaN, 30)).toBe(0);
    expect(msToFrames(1000, 0)).toBe(0);
    expect(framesToMs(10, -1)).toBe(0);
    expect(roundMs(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('formatTimecode 输出 HH:MM:SS:FF', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
    expect(formatTimecode(1000, 30)).toBe('00:00:01:00');
    expect(formatTimecode(1234, 30)).toBe('00:00:01:07');
    expect(formatTimecode(3_661_000, 30)).toBe('01:01:01:00');
  });

  it('formatDuration 在一小时处切换格式', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_661_000)).toBe('01:01:01');
  });

  it('formatDurationHuman 输出中文描述', () => {
    expect(formatDurationHuman(500)).toBe('500 毫秒');
    expect(formatDurationHuman(65_000)).toBe('1 分 5 秒');
    expect(formatDurationHuman(3_661_000)).toBe('1 小时 1 分 1 秒');
  });

  it('parseTimecode 支持帧/毫秒/分钟三种写法', () => {
    expect(parseTimecode('00:00:01.500')).toBe(1500);
    expect(parseTimecode('00:00:01,500')).toBe(1500);
    expect(parseTimecode('00:00:01:15', 30)).toBe(1500);
    expect(parseTimecode('01:30.000')).toBe(90_000);
    expect(parseTimecode('garbage')).toBeNull();
    expect(parseTimecode('')).toBeNull();
  });

  it('frameDurationMs 返回单帧时长', () => {
    expect(frameDurationMs(30)).toBeCloseTo(33.333, 2);
    expect(frameDurationMs(0)).toBe(0);
  });
});
