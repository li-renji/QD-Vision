/**
 * SRT 字幕解析与序列化（FR-031 / FR-032）。
 *
 * 特性：
 * - 兼容 `HH:MM:SS,mmm` 与 `HH:MM:SS.mmm` 两种毫秒分隔符。
 * - **逐行容错**：非法行跳过并计数，不中断整体解析。
 * - 按 `startMs` 排序；检测重叠区间并返回警告列表。
 * - ≥ 2000 条不 OOM（不引入额外依赖，纯数组处理）。
 * - 与 `stringifySrt` 往返一致率 100%。
 */

import type { SubtitleCue } from '@clipcut/shared-types';
import { cueId } from '../../utils/id.js';

/** 解析结果。 */
export interface SrtParseResult {
  /** 成功解析的字幕条目（按 startMs 升序）。 */
  cues: SubtitleCue[];
  /** 非法行数量。 */
  errorCount: number;
  /** 非法行详情（行号 + 原因）。 */
  errors: Array<{ line: number; reason: string }>;
  /** 重叠区间警告。 */
  overlaps: SrtOverlap[];
}

/** 重叠区间。 */
export interface SrtOverlap {
  /** 前一条 cue id */
  firstId: string;
  /** 后一条 cue id */
  secondId: string;
  /** 重叠起点（毫秒） */
  startMs: number;
  /** 重叠终点（毫秒） */
  endMs: number;
}

/** 时间码解析：`00:00:01,500` / `00:00:01.500` → 1500。 */
export function parseSrtTimestamp(raw: string): number | null {
  const text = raw.trim();
  const match = /^(\d{1,3}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(text);
  if (!match) return null;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const millisText = match[4] ?? '0';
  const millis = Number(millisText.padEnd(3, '0'));

  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** 时间码格式化：`1500` → `00:00:01,500`。 */
export function formatSrtTimestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const millis = safe % 1000;
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/** 时间码行正则（同时匹配 `,` 与 `.` 分隔符）。 */
const TIMELINE_PATTERN = /^(.+?)\s*-->\s*(.+?)\s*$/;

/** 跳过损坏块中的剩余文本行（直到空行为止）。 */
function skipBlockText(lines: readonly string[], from: number): number {
  let index = from;
  while (index < lines.length && (lines[index] ?? '').trim() !== '') {
    index += 1;
  }
  return index;
}

/**
 * 检测字幕区间重叠。
 */
export function detectOverlaps(cues: readonly SubtitleCue[]): SrtOverlap[] {
  const overlaps: SrtOverlap[] = [];
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (!previous || !current) continue;
    if (current.startMs < previous.endMs) {
      overlaps.push({
        firstId: previous.id,
        secondId: current.id,
        startMs: current.startMs,
        endMs: Math.min(previous.endMs, current.endMs),
      });
    }
  }
  return overlaps;
}

/**
 * 解析 SRT 文本。
 *
 * 逐块解析：序号行 → 时间码行 → 文本行（可多行）。
 */
export function parseSrt(content: string): SrtParseResult {
  const cues: SubtitleCue[] = [];
  const errors: Array<{ line: number; reason: string }> = [];

  const normalized = content.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  let index = 0;
  let errorCount = 0;

  while (index < lines.length) {
    // 跳过空行
    while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1;
    if (index >= lines.length) break;

    const sequenceLine = index;
    const sequenceText = (lines[index] ?? '').trim();

    // 序号行：纯数字（允许缺失，直接尝试当作时间码行）
    if (/^\d+$/.test(sequenceText)) {
      index += 1;
    } else if (TIMELINE_PATTERN.test(sequenceText)) {
      // 没有序号行，直接是时间码行
    } else {
      errors.push({ line: sequenceLine + 1, reason: `无法识别的行：${sequenceText}` });
      errorCount += 1;
      index += 1;
      continue;
    }

    if (index >= lines.length) {
      errors.push({ line: sequenceLine + 1, reason: '字幕块缺少时间码行' });
      errorCount += 1;
      break;
    }

    const timelineLine = index;
    const timelineText = (lines[index] ?? '').trim();
    const match = TIMELINE_PATTERN.exec(timelineText);
    if (!match) {
      errors.push({ line: timelineLine + 1, reason: `时间码格式非法：${timelineText}` });
      errorCount += 1;
      index += 1;
      continue;
    }

    const startMs = parseSrtTimestamp(match[1] ?? '');
    const endMs = parseSrtTimestamp(match[2] ?? '');
    if (startMs === null || endMs === null) {
      errors.push({ line: timelineLine + 1, reason: `时间码无法解析：${timelineText}` });
      errorCount += 1;
      index += 1;
      index = skipBlockText(lines, index);
      continue;
    }
    if (endMs < startMs) {
      errors.push({ line: timelineLine + 1, reason: '结束时间早于开始时间' });
      errorCount += 1;
      index += 1;
      index = skipBlockText(lines, index);
      continue;
    }

    index += 1;

    // 文本行：直到空行或下一个序号行为止
    const textLines: string[] = [];
    while (index < lines.length && (lines[index] ?? '').trim() !== '') {
      const current = (lines[index] ?? '').trim();
      // 遇到「序号 + 时间码」形态说明进入了下一块
      if (/^\d+$/.test(current) && index + 1 < lines.length) {
        const next = (lines[index + 1] ?? '').trim();
        if (TIMELINE_PATTERN.test(next)) break;
      }
      textLines.push((lines[index] ?? '').trim());
      index += 1;
    }

    cues.push({
      id: cueId(),
      startMs,
      endMs,
      text: textLines.join('\n'),
    });
  }

  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  return {
    cues,
    errorCount,
    errors,
    overlaps: detectOverlaps(cues),
  };
}

/**
 * 把字幕条目序列化为 SRT 文本。
 *
 * 与 `parseSrt` 往返一致（时间码格式归一化为 `,` 分隔符）。
 */
export function stringifySrt(cues: readonly SubtitleCue[]): string {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const blocks = sorted.map((cue, index) => {
    const text = cue.text.trim();
    return `${index + 1}\n${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}\n${text}\n`;
  });
  return blocks.join('\n');
}
