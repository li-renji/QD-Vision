/**
 * SRT 解析容错 + 往返一致测试（FR-031 / FR-032）。
 */

import { describe, expect, it } from 'vitest';
import {
  detectOverlaps,
  formatSrtTimestamp,
  parseSrt,
  parseSrtTimestamp,
  stringifySrt,
} from '../srt.js';

describe('domain/subtitles/srt', () => {
  it('解析标准 SRT', () => {
    const content = ['1', '00:00:01,000 --> 00:00:03,500', '第一句', '', '2', '00:00:04,000 --> 00:00:06,000', '第二句'].join(
      '\n',
    );
    const result = parseSrt(content);
    expect(result.errorCount).toBe(0);
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0]?.startMs).toBe(1000);
    expect(result.cues[0]?.endMs).toBe(3500);
    expect(result.cues[0]?.text).toBe('第一句');
  });

  it('同时支持 `,` 与 `.` 毫秒分隔符', () => {
    expect(parseSrtTimestamp('00:00:01,500')).toBe(1500);
    expect(parseSrtTimestamp('00:00:01.500')).toBe(1500);
  });

  it('逐行容错：非法行被跳过并计数，不中断解析', () => {
    const content = [
      '1',
      '00:00:01,000 --> 00:00:03,500',
      '第一句',
      '',
      '这是一行非法内容',
      '',
      '2',
      '00:00:0X,000 --> 00:00:06,000',
      '时间码非法',
      '',
      '3',
      '00:00:04,000 --> 00:00:06,000',
      '第三句',
    ].join('\n');

    const result = parseSrt(content);
    expect(result.cues).toHaveLength(2);
    expect(result.errorCount).toBe(2);
    expect(result.errors).toHaveLength(2);
  });

  it('按 startMs 排序', () => {
    const content = [
      '1',
      '00:00:05,000 --> 00:00:06,000',
      '后',
      '',
      '2',
      '00:00:01,000 --> 00:00:02,000',
      '前',
    ].join('\n');
    const result = parseSrt(content);
    expect(result.cues[0]?.text).toBe('前');
  });

  it('检测重叠区间', () => {
    const content = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      'A',
      '',
      '2',
      '00:00:03,000 --> 00:00:06,000',
      'B',
    ].join('\n');
    const result = parseSrt(content);
    expect(result.overlaps).toHaveLength(1);
    expect(result.overlaps[0]?.startMs).toBe(3000);
    expect(result.overlaps[0]?.endMs).toBe(4000);
  });

  it('往返一致率 100%', () => {
    const content = [
      '1',
      '00:00:01,000 --> 00:00:03,500',
      '第一句',
      '',
      '2',
      '00:00:04,000 --> 00:00:06,000',
      '第二句',
      '换行保留',
    ].join('\n');

    const first = parseSrt(content);
    const text = stringifySrt(first.cues);
    const second = parseSrt(text);

    expect(second.cues).toHaveLength(first.cues.length);
    for (let i = 0; i < first.cues.length; i += 1) {
      expect(second.cues[i]?.startMs).toBe(first.cues[i]?.startMs);
      expect(second.cues[i]?.endMs).toBe(first.cues[i]?.endMs);
      expect(second.cues[i]?.text).toBe(first.cues[i]?.text);
    }
  });

  it('时间码格式化', () => {
    expect(formatSrtTimestamp(1500)).toBe('00:00:01,500');
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(3_661_000)).toBe('01:01:01,000');
  });

  it('detectOverlaps 对无重叠输入返回空数组', () => {
    const result = parseSrt(['1', '00:00:01,000 --> 00:00:02,000', 'A'].join('\n'));
    expect(detectOverlaps(result.cues)).toHaveLength(0);
  });

  it('支持 2000 条字幕不崩', () => {
    const blocks: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const start = i * 1000;
      const end = start + 900;
      blocks.push(`${i + 1}`, `${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}`, `第 ${i + 1} 句`, '');
    }
    const result = parseSrt(blocks.join('\n'));
    expect(result.cues).toHaveLength(2000);
    expect(result.errorCount).toBe(0);
  });
});
