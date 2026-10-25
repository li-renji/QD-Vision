/**
 * 图标集（内联 SVG）。
 *
 * ## 为什么不用 emoji
 *
 * V1.0 曾用 🔊👁🔓✂🗑📋🧲 等 emoji 当图标，在 11~13px 的中文界面里问题集中：
 *
 * 1. **字重不统一** —— 👁 是细描边、🔓 是厚实黄色挂锁，并排放视觉落差极大；
 * 2. **无法继承颜色** —— emoji 走系统彩色字体，`text-[var(--cc-fg-secondary)]`
 *    与 `active` 态的高亮对它们无效，「已静音 / 已锁定」看不出状态；
 * 3. **依赖系统字体** —— 缺字体的平台直接渲染成豆腐块 □；
 * 4. **基线漂移** —— emoji 的基线与相邻中文不对齐，行内混排时明显「浮」起来。
 *
 * 内联 SVG 全部走 `currentColor` + 统一 `1.75` 描边，字重、颜色、基线三者全部可控。
 */

/** 可用图标名。 */
export type IconName =
  | 'volume-on'
  | 'volume-off'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'scissors'
  | 'trash'
  | 'copy'
  | 'clipboard'
  | 'magnet'
  | 'plus'
  | 'minus'
  | 'play'
  | 'pause'
  | 'skip-start'
  | 'skip-end'
  | 'step-start'
  | 'step-end'
  | 'undo'
  | 'redo'
  | 'settings'
  | 'grid'
  | 'list'
  | 'clock'
  | 'timer'
  | 'pencil'
  | 'close'
  | 'film'
  | 'chevron-up'
  | 'chevron-down';

/** 图标属性。 */
export interface IconProps {
  name: IconName;
  /** 边长（px）。默认 14 —— 与 11~12px 的中文正文视觉重量匹配。 */
  size?: number;
  className?: string;
}

/**
 * 单个图标的路径定义。
 *
 * 约定：默认 `fill="none" stroke="currentColor"`；需要实心的形状单独写
 * `fill="currentColor" stroke="none"`。
 */
const PATHS: Record<IconName, JSX.Element> = {
  'volume-on': (
    <>
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" />
      <path d="M15.2 9.2a4 4 0 0 1 0 5.6" />
      <path d="M17.9 6.5a7.6 7.6 0 0 1 0 11" />
    </>
  ),
  'volume-off': (
    <>
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" />
      <path d="m15.5 9.5 5 5" />
      <path d="m20.5 9.5-5 5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 6a9.6 9.6 0 0 1 2.1-.2c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.4 3.3" />
      <path d="M6.2 7.8A16.8 16.8 0 0 0 2.5 12S6 18.2 12 18.2a9.3 9.3 0 0 0 3.5-.7" />
      <path d="M10 10a2.8 2.8 0 0 0 3.9 3.9" />
      <path d="m3.5 3.5 17 17" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 7.6-1.7" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <path d="M20 4 8.7 15.3" />
      <path d="M14.6 14.6 20 20" />
      <path d="M8.7 8.7 11.6 11.6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6 7v12.2A1.8 1.8 0 0 0 7.8 21h8.4a1.8 1.8 0 0 0 1.8-1.8V7" />
      <path d="M10.5 11v6" />
      <path d="M13.5 11v6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.2 15H4.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1H14a1 1 0 0 1 1 1v.7" />
    </>
  ),
  clipboard: (
    <>
      <path d="M7 5.5H5.8A1.8 1.8 0 0 0 4 7.3v12A1.8 1.8 0 0 0 5.8 21h12.4a1.8 1.8 0 0 0 1.8-1.8v-12a1.8 1.8 0 0 0-1.8-1.8H17" />
      <rect x="7" y="3" width="10" height="4.6" rx="1.4" />
      <path d="M9.5 12h5" />
      <path d="M9.5 16h3.5" />
    </>
  ),
  magnet: (
    <>
      <path d="M5 4h4.2v7a2.8 2.8 0 0 0 5.6 0V4H19v7a7 7 0 0 1-14 0V4Z" />
      <path d="M5 8.6h4.2" />
      <path d="M14.8 8.6H19" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </>
  ),
  minus: <path d="M5.5 12h13" />,
  play: <path d="M8 5.4v13.2L19 12 8 5.4Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  'skip-start': (
    <>
      <path d="M18 6.2v11.6L9.4 12 18 6.2Z" fill="currentColor" stroke="none" />
      <path d="M6 5.6v12.8" />
    </>
  ),
  'skip-end': (
    <>
      <path d="M6 6.2v11.6L14.6 12 6 6.2Z" fill="currentColor" stroke="none" />
      <path d="M18 5.6v12.8" />
    </>
  ),
  'step-start': (
    <>
      <path d="M15.5 6.6v10.8L9 12l6.5-5.4Z" fill="currentColor" stroke="none" />
      <path d="M6.2 6.2v11.6" />
    </>
  ),
  'step-end': (
    <>
      <path d="M8.5 6.6v10.8L15 12l-6.5-5.4Z" fill="currentColor" stroke="none" />
      <path d="M17.8 6.2v11.6" />
    </>
  ),
  undo: (
    <>
      <path d="M4.5 9.5h9.8a5 5 0 0 1 0 10H9" />
      <path d="m8.4 5.2-3.9 4.3 3.9 4.3" />
    </>
  ),
  redo: (
    <>
      <path d="M19.5 9.5H9.7a5 5 0 0 0 0 10H15" />
      <path d="m15.6 5.2 3.9 4.3-3.9 4.3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h8.5" />
      <path d="M17.5 7.5H20" />
      <circle cx="15" cy="7.5" r="2.3" />
      <path d="M4 16.5h3.5" />
      <path d="M12.5 16.5H20" />
      <circle cx="9.5" cy="16.5" r="2.3" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </>
  ),
  list: (
    <>
      <path d="M4 6.8h16" />
      <path d="M4 12h16" />
      <path d="M4 17.2h16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  timer: (
    <>
      <path d="M9.6 3.2h4.8" />
      <path d="M12 3.2v2.4" />
      <circle cx="12" cy="13.6" r="7.4" />
      <path d="M12 10.2v3.4l2.4 1.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20.2h4.2L20.4 8a2.9 2.9 0 0 0-4.2-4.2L4 16v4.2Z" />
      <path d="m14.6 5.6 3.8 3.8" />
    </>
  ),
  close: (
    <>
      <path d="m6.2 6.2 11.6 11.6" />
      <path d="m17.8 6.2-11.6 11.6" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7.2 5v14" />
      <path d="M16.8 5v14" />
      <path d="M3 12h18" />
    </>
  ),
  'chevron-up': (
    <>
      <path d="m6 14.5 6-6 6 6" />
    </>
  ),
  'chevron-down': (
    <>
      <path d="m6 9.5 6 6 6-6" />
    </>
  ),
};

/**
 * 图标。
 *
 * 纯展示型：`aria-hidden` 固定为 true —— 所有图标按钮都由外层
 * `IconButton` / `Button` 提供 `aria-label`，图标本身不应进无障碍树，
 * 否则读屏会念出「按钮 剪刀 分割」这种重复内容。
 */
export function Icon({ name, size = 14, className }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...(className ? { className } : {})}
      data-icon={name}
    >
      {PATHS[name]}
    </svg>
  );
}