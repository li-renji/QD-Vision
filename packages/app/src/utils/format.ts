/**
 * 展示格式化工具：字节、码率、分辨率、日期。
 */

/** 字节 → 人类可读。 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(fractionDigits)} ${units[unitIndex] ?? 'B'}`;
}

/** 码率（bps）→ 人类可读。 */
export function formatBitrate(bitsPerSecond: number): string {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '—';
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

/** 分辨率 → `1920×1080`。 */
export function formatResolution(width: number | null, height: number | null): string {
  if (width === null || height === null) return '—';
  return `${width}×${height}`;
}

/** ISO 字符串 → `YYYY-MM-DD HH:mm`。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** 相对时间描述（刚刚 / N 分钟前 / N 小时前 / 日期）。 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) return '—';
  const diff = Math.max(0, now - date);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return formatDateTime(iso);
}
