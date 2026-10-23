/**
 * 领域层：字幕子模块（SRT 解析与序列化）。
 */

export {
  type SrtParseResult,
  type SrtOverlap,
  detectOverlaps,
  formatSrtTimestamp,
  parseSrt,
  parseSrtTimestamp,
  stringifySrt,
} from './srt.js';
