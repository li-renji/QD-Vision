/**
 * 颜色工具：`#RRGGBB` ↔ `rgba()`、亮度对比（描边默认色推导）。
 */

/** RGBA 分量。 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 解析 `#RGB` / `#RRGGBB`；失败时返回 null。 */
export function parseHexColor(hex: string): Rgba | null {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) return null;
  let body = match[1] ?? '';
  if (body.length === 3) {
    body = body
      .split('')
      .map((c) => `${c}${c}`)
      .join('');
  }
  const r = Number.parseInt(body.slice(0, 2), 16);
  const g = Number.parseInt(body.slice(2, 4), 16);
  const b = Number.parseInt(body.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b, a: 1 };
}

/** 转为 `rgba(r, g, b, a)` 字符串。 */
export function toRgbaString(color: Rgba): string {
  const alpha = Math.min(1, Math.max(0, color.a));
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
}

/** 把任意颜色转为 `rgba()` 串（仅支持 #RGB/#RRGGBB 与 rgba() 输入）。 */
export function withAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  const parsed = parseHexColor(trimmed);
  if (parsed) return toRgbaString({ ...parsed, a: alpha });

  const match = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (match) {
    const parts = (match[1] ?? '').split(',').map((p) => Number.parseFloat(p.trim()));
    const [r = 0, g = 0, b = 0] = parts;
    return toRgbaString({ r, g, b, a: alpha });
  }
  return color;
}

/** 相对亮度（WCAG 公式）。 */
export function relativeLuminance(color: string): number {
  const parsed = parseHexColor(color);
  if (!parsed) return 0;
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(parsed.r) + 0.7152 * channel(parsed.g) + 0.0722 * channel(parsed.b);
}

/** 前景色与背景色的对比度（1~21）。 */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 依据文字颜色推导描边色：亮字配黑描边，暗字配白描边。
 */
export function deriveStrokeColor(textColor: string): string {
  return relativeLuminance(textColor) > 0.5 ? '#000000' : '#FFFFFF';
}
