/**
 * ID 生成工具。
 *
 * 工程 id 使用 uuid v4；其余实体使用带前缀的可读 id，便于在日志与调试中辨识类型。
 */

/** uuid v4。 */
export function projectId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  // 兜底：手写 uuid v4（使用 getRandomValues，仍满足 RFC 4122 位布局）。
  const bytes = new Uint8Array(16);
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 生成带前缀的短 id。 */
function prefixedId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${random}`;
}

/** 素材 id。 */
export function assetId(): string {
  return prefixedId('asset');
}

/** clip id。 */
export function clipId(): string {
  return prefixedId('clip');
}

/** 轨道 id。 */
export function trackId(): string {
  return prefixedId('track');
}

/** 字幕条目 id。 */
export function cueId(): string {
  return prefixedId('cue');
}

/** 导出任务 id。 */
export function exportJobId(): string {
  return prefixedId('job');
}

/** 会话 id（MCP 通道握手用）。 */
export function sessionId(): string {
  return prefixedId('session');
}
