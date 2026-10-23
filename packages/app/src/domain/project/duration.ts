/**
 * 派生量计算（ARCHITECTURE §5.1 —— 唯一实现处）。
 *
 * `meta.durationMs` = max(所有 clip 的 startMs + durationMs, 所有 cue 的 endMs)。
 */

import type { ProjectDoc } from '@clipcut/shared-types';

/**
 * 计算工程总时长（毫秒）。
 *
 * 该值是**派生量**：不作为数据源存储，只在序列化时写入缓存、加载时重算覆盖。
 */
export function computeProjectDuration(doc: ProjectDoc): number {
  let max = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.startMs + clip.durationMs);
    }
  }
  for (const cue of doc.subtitles.cues) {
    max = Math.max(max, cue.endMs);
  }
  return max;
}
