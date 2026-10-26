/**
 * 音量包络（CapCut / 剪映风格的「横线 + 可调节节点」）。
 *
 * - 画布内一条横线代表「恒定音量 = clip.audio.gain」；
 * - 双击横线任意位置新增一个节点；拖动节点上下改增益（0~2）、左右改时间；
 * - 双击节点删除该节点（删除后回到恒定音量）。
 *
 * 节点拖拽期间只更新本地 draft，抬起指针才提交一次（1 条历史记录）。
 *
 * ## 为什么交互全部挂在**细条 `<svg>`** 上，而不是每个 `<circle>`
 *
 * 早期把 `onPointerDown` 挂在 `<circle>` 上，实测在部分环境（headless Chromium /
 * 合成输入）下 `document.elementFromPoint` 落在节点中心返回的竟是外层 `<svg>`，
 * 小圆点根本不是命中目标 —— 节点拖拽完全失效（`pointer-events:auto` + 不透明
 * fill 也救不回来，属于 SVG 子元素命中在地化实现里的坑）。
 *
 * 因此改为：**圆点只负责视觉（`pointer-events:none`）**，所有指针交互统一挂在
 * 可命中的细条 `<svg>` 上，用**数学命中**（离哪颗节点最近）来决定抓取/删除谁。
 * 这样彻底不依赖「小圆点被精确点到」。
 *
 * ## 为什么是「底部细条」而不是铺满整个 clip
 *
 * 更早版本用 `absolute inset-0` 铺满整个 clip，`pointer-events:auto` 把**整个
 * 片段**都变成包络命中区 —— `useClipDrag` 的守卫（命中 `[data-volume-envelope]`
 * 就跳过 clip 拖拽）于是对每次按下都生效，片段在时间线里再也拖不动了（用户反馈
 * 「视频轨道里不能拖动」）。改成只在**底部 28px 细条**内响应（与剪映 / CapCut
 * 一致）：细条内编辑包络，细条以外的片段主体仍可正常拖动 / 选中。
 */

import { useEffect, useRef, useState } from 'react';
import type { AudioEnvelopePoint, Clip } from '@clipcut/shared-types';

/** 增益范围（与 `AudioEnvelopePoint.gain` 一致）。 */
const GAIN_MIN = 0;
const GAIN_MAX = 2;

/** 抓取 / 删除节点的命中半径（px）：按下点距某颗节点不超过它即算抓住该节点。 */
const NODE_HIT_RADIUS = 14;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** VolumeEnvelope 属性。 */
export interface VolumeEnvelopeProps {
  clip: Clip;
  pxPerSecond: number;
  /** 提交（指针抬起时调用一次）。 */
  onChange: (points: AudioEnvelopePoint[]) => void;
}

/**
 * 音量包络组件。
 */
export function VolumeEnvelope({ clip, pxPerSecond, onChange }: VolumeEnvelopeProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // 拖拽中的本地草稿（避免每次移动都写 store / 产生历史记录）。
  const [draft, setDraft] = useState<AudioEnvelopePoint[] | null>(null);
  // 拖拽实时值的引用（commit 时读取最新值，避免闭包拿到拖拽前的旧快照）。
  const draftRef = useRef<AudioEnvelopePoint[] | null>(null);
  const [height, setHeight] = useState(40);

  const widthPx = (clip.durationMs / 1000) * pxPerSecond;
  const baseGain = clip.audio.gain;
  const stored = clip.audio.envelope ?? [];
  const points = draft ?? stored;

  // 测量实际高度（clip 高度随轨道高度变化）。
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0) setHeight(rect.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const yForGain = (gain: number): number =>
    height * (1 - clamp(gain, GAIN_MIN, GAIN_MAX) / GAIN_MAX);
  const xForTime = (timeMs: number): number =>
    (widthPx * clamp(timeMs, 0, clip.durationMs)) / clip.durationMs;

  /** 渲染折线：含两端延伸（左端取首节点增益，右端取末节点增益；无节点则恒定 baseGain）。 */
  const sorted = [...points].sort((a, b) => a.timeMs - b.timeMs);
  const renderPts: Array<{ x: number; y: number }> = [];
  if (sorted.length === 0) {
    renderPts.push({ x: 0, y: yForGain(baseGain) }, { x: widthPx, y: yForGain(baseGain) });
  } else {
    const first = sorted[0];
    const lastNode = sorted[sorted.length - 1];
    if (first && lastNode) {
      renderPts.push({ x: 0, y: yForGain(first.gain) });
      for (const p of sorted) renderPts.push({ x: xForTime(p.timeMs), y: yForGain(p.gain) });
      renderPts.push({ x: widthPx, y: yForGain(lastNode.gain) });
    }
  }
  const pathD = renderPts
    .map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  /** 把客户端坐标换算成细条内的局部坐标 + 对应的 (timeMs, gain)。 */
  const toLocal = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number; timeMs: number; gain: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    const w = rect?.width ?? widthPx;
    const h = rect?.height ?? height;
    const x = clientX - (rect?.left ?? 0);
    const y = clientY - (rect?.top ?? 0);
    return {
      x,
      y,
      timeMs: clamp((clip.durationMs * x) / w, 0, clip.durationMs),
      gain: clamp(GAIN_MAX * (1 - y / h), GAIN_MIN, GAIN_MAX),
    };
  };

  /** 数学命中：返回离局部坐标 (x,y) 最近、且在 {@link NODE_HIT_RADIUS} 内的节点索引；无则 -1。 */
  const findNodeAt = (x: number, y: number): number => {
    let best = -1;
    let bestDist = NODE_HIT_RADIUS;
    for (let index = 0; index < sorted.length; index += 1) {
      const point = sorted[index];
      if (!point) continue;
      const dx = x - xForTime(point.timeMs);
      const dy = y - yForGain(point.gain);
      const dist = Math.hypot(dx, dy);
      if (dist <= bestDist) {
        bestDist = dist;
        best = index;
      }
    }
    return best;
  };

  /**
   * 细条上按下：命中某颗节点则开始拖拽它；空白处不拦截（留给双击加点）。
   *
   * 交互全部挂在可命中的 `<svg>` 上（圆点 `pointer-events:none`），靠数学命中
   * 决定抓取谁 —— 规避「小圆点在部分环境根本不是 elementFromPoint 目标」的坑。
   */
  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    const { x, y } = toLocal(event.clientX, event.clientY);
    const index = findNodeAt(x, y);
    if (index < 0) return; // 空白处：不抓取
    event.preventDefault();

    let moved = false;
    const move = (moveEvent: PointerEvent): void => {
      const p = toLocal(moveEvent.clientX, moveEvent.clientY);
      const next = [...points];
      next[index] = {
        timeMs: Math.round(p.timeMs),
        gain: Math.round(p.gain * 100) / 100,
      };
      moved = true;
      draftRef.current = next;
      setDraft(next);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // 只有真的拖动过才提交：避免「点了下节点却没动」也写一条（相同值的）历史。
      if (moved && draftRef.current) {
        const committed = [...draftRef.current].sort((a, b) => a.timeMs - b.timeMs);
        onChange(committed);
      }
      draftRef.current = null;
      setDraft(null);
    };

    // 先挂 window 监听（pointermove 必冒泡到 window，拖拽即可工作），再尝试把指针
    // 捕获到细条上（拖出细条也不丢事件）；捕获在个别环境可能抛错，try/catch 兜底。
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // 捕获失败：忽略，交由上面的 window 监听兜底。
    }
  };

  /** 双击：命中节点 → 删除；空白 → 在该处新增节点。 */
  const handleDoubleClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    const { x, y, timeMs, gain } = toLocal(event.clientX, event.clientY);
    const index = findNodeAt(x, y);
    if (index >= 0) {
      const next = sorted.filter((_, i) => i !== index);
      onChange(next);
      return;
    }
    const next = [
      ...stored,
      { timeMs: Math.round(timeMs), gain: Math.round(gain * 100) / 100 },
    ];
    next.sort((a, b) => a.timeMs - b.timeMs);
    onChange(next);
  };

  return (
    <svg
      ref={svgRef}
      data-volume-envelope=""
      className="absolute bottom-0 left-0 h-7 w-full"
      style={{
        pointerEvents: 'auto',
        touchAction: 'none',
        cursor: sorted.length > 0 ? 'grab' : 'crosshair',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* gain=1 基准线（视觉参考）。 */}
      <line
        x1={0}
        y1={yForGain(1)}
        x2={widthPx}
        y2={yForGain(1)}
        stroke="rgba(255,255,255,0.25)"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      {/* 包络折线。 */}
      <path d={pathD} fill="none" stroke="#f5c542" strokeWidth={2} />
      {/* 节点：仅视觉，命中由外层 <svg> 统一处理（避免小圆点命中不到）。 */}
      {sorted.map((point, index) => (
        <circle
          key={index}
          cx={xForTime(point.timeMs)}
          cy={yForGain(point.gain)}
          r={5}
          fill="#ffffff"
          stroke="#f5c542"
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
        />
      ))}
    </svg>
  );
}
