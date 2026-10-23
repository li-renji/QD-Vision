/**
 * 时间工具：毫秒 ↔ 帧、时间码格式化与解析。
 *
 * **全项目时间单位统一为毫秒整数**，序列化前统一 `Math.round`。
 */

/** 毫秒转帧数（四舍五入）。 */
export function msToFrames(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round((ms / 1000) * fps);
}

/** 帧数转毫秒（四舍五入）。 */
export function framesToMs(frame: number, fps: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round((frame / fps) * 1000);
}

/** 毫秒四舍五入为整数。 */
export function roundMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/** 单帧时长（毫秒）。 */
export function frameDurationMs(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return 1000 / fps;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * 格式化为时间码 `HH:MM:SS:FF`。
 *
 * @param ms 时间（毫秒）
 * @param fps 帧率
 */
export function formatTimecode(ms: number, fps: number): string {
  const safeMs = Math.max(0, roundMs(ms));
  const safeFps = fps > 0 ? fps : 30;
  const totalFrames = msToFrames(safeMs, safeFps);
  const frames = totalFrames % Math.round(safeFps);
  const totalSeconds = Math.floor(safeMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}:${pad2(frames)}`;
}

/**
 * 格式化为时长 `mm:ss`（不足一小时）或 `hh:mm:ss`。
 */
export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, roundMs(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * 解析时间码。支持：
 * - `HH:MM:SS:FF`（帧）
 * - `HH:MM:SS.mmm` / `HH:MM:SS,mmm`（毫秒）
 * - `MM:SS.mmm`
 *
 * @returns 解析出的毫秒数；无法解析时返回 `null`。
 */
export function parseTimecode(input: string, fps = 30): number | null {
  const text = input.trim();
  if (text.length === 0) return null;

  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 4) return null;

  const numbers: number[] = [];
  for (const part of parts) {
    const normalized = part.replace(',', '.');
    if (normalized.length === 0) return null;
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0) return null;
    numbers.push(value);
  }

  if (numbers.length === 4) {
    const [h = 0, m = 0, s = 0, f = 0] = numbers;
    const fpsSafe = fps > 0 ? fps : 30;
    return roundMs(((h * 60 + m) * 60 + s) * 1000 + (f / fpsSafe) * 1000);
  }

  if (numbers.length === 3) {
    const [h = 0, m = 0, s = 0] = numbers;
    const secondsPart = Math.floor(s);
    const fraction = s - secondsPart;
    return roundMs(((h * 60 + m) * 60 + secondsPart) * 1000 + fraction * 1000);
  }

  const [m = 0, s = 0] = numbers;
  const secondsPart = Math.floor(s);
  const fraction = s - secondsPart;
  return roundMs(m * 60 * 1000 + secondsPart * 1000 + fraction * 1000);
}

/** 人类可读的时长描述（中文），用于 UI 展示。 */
export function formatDurationHuman(ms: number): string {
  const safeMs = Math.max(0, roundMs(ms));
  if (safeMs < 1000) return `${safeMs} 毫秒`;
  const totalSeconds = Math.floor(safeMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分 ${seconds} 秒`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}
