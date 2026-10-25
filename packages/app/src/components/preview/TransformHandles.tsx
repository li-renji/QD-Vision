/**
 * 预览画布上的变换手柄（移动 / 缩放 / 旋转）。
 *
 * ## 为什么需要
 *
 * 此前 transform（位置 / 缩放 / 旋转）只能在属性面板用数字框改，画布上无法
 * 直接拖拽。用户反馈「字幕 / 片段无法放大缩小、移动、旋转」。本组件在画布上
 * 叠加一层 SVG 手柄，直接拖拽即可改 `clip.transform`。
 *
 * ## 坐标约定
 *
 * SVG 的 `viewBox` = `0 0 canvasWidth canvasHeight`，且被定位成与 `<canvas>`
 * 显示区域**完全重合**，因此 SVG 用户坐标 == 画布像素坐标，无需再做屏幕↔画布换算
 * （旋转用 group `transform` 处理）。唯一需要做的是把**屏幕位移**换算成画布位移：
 * `canvasDelta = screenDelta / displayScale`，其中 `displayScale = 显示宽 / 画布宽`。
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { ClipTransform } from '@clipcut/shared-types';

/** 手柄尺寸（画布像素）。 */
const HANDLE_R = 9;
const ROTATE_OFFSET = 48;
/** viewBox 外边距（画布像素）：给旋转手柄 / 边角手柄留出不被裁剪的空间。 */
const VIEWBOX_MARGIN = 64;

/** 拖拽模式。 */
type DragMode = 'move' | 'scale' | 'rotate';

/** 拖拽起始快照。 */
interface DragStart {
  mode: DragMode;
  pointerX: number;
  pointerY: number;
  transform: ClipTransform;
  centerScreenX: number;
  centerScreenY: number;
  startDist: number;
  startAngle: number;
}

/** 变换手柄属性。 */
export interface TransformHandlesProps {
  /** 被叠加的画布元素（用于测量显示区域）。 */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** 当前选中的 clip 的 transform。 */
  transform: ClipTransform;
  /** 画布内在宽 / 高（像素）。 */
  canvasWidth: number;
  canvasHeight: number;
  /** 拖拽过程中实时提交（供预览用，不一定立即写历史）。 */
  onChange: (patch: Partial<ClipTransform>) => void;
  /** 整个拖拽手势结束时提交（父层据此写一条历史记录）。 */
  onCommit?: () => void;
}

/**
 * 变换手柄层。
 */
export function TransformHandles({
  canvasRef,
  transform,
  canvasWidth,
  canvasHeight,
  onChange,
  onCommit,
}: TransformHandlesProps): JSX.Element | null {
  // 叠加层相对画布父容器的定位盒（与 canvas 显示区域重合）。
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const dragRef = useRef<DragStart | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sync = (): void => {
      const parent = canvas.offsetParent as HTMLElement | null;
      const prect = parent?.getBoundingClientRect();
      const crect = canvas.getBoundingClientRect();
      setBox({
        left: crect.left - (prect?.left ?? 0),
        top: crect.top - (prect?.top ?? 0),
        width: crect.width,
        height: crect.height,
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(canvas);
    if (canvas.offsetParent) observer.observe(canvas.offsetParent);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [canvasRef]);

  if (!box) return null;

  const displayScale = box.width / canvasWidth;
  // 把 viewBox 向外扩一圈，使画布外的旋转手柄也能完整显示（不被 SVG 裁剪）。
  const marginCss = VIEWBOX_MARGIN * displayScale;

  // 画布像素空间下的中心与半边长（以完整画布为参考框 → 对应 fit='fill' 心智模型）。
  const cx = transform.x * canvasWidth;
  const cy = transform.y * canvasHeight;
  const hw = (canvasWidth / 2) * transform.scale;
  const hh = (canvasHeight / 2) * transform.scale;
  const rot = transform.rotation;

  const startDrag = (mode: DragMode) => (event: React.PointerEvent): void => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const crect = canvas.getBoundingClientRect();
    const centerScreenX = crect.left + cx * displayScale;
    const centerScreenY = crect.top + cy * displayScale;
    dragRef.current = {
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      transform: { ...transform },
      centerScreenX,
      centerScreenY,
      startDist: Math.hypot(event.clientX - centerScreenX, event.clientY - centerScreenY),
      startAngle: Math.atan2(event.clientY - centerScreenY, event.clientX - centerScreenX),
    };
  };

  const onPointerMove = (event: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ds = canvas.offsetWidth / canvasWidth;

    if (d.mode === 'move') {
      const dx = (event.clientX - d.pointerX) / ds;
      const dy = (event.clientY - d.pointerY) / ds;
      onChange({
        x: clamp01(d.transform.x + dx / canvasWidth),
        y: clamp01(d.transform.y + dy / canvasHeight),
      });
    } else if (d.mode === 'scale') {
      const dist = Math.hypot(event.clientX - d.centerScreenX, event.clientY - d.centerScreenY);
      const ratio = d.startDist > 1 ? dist / d.startDist : 1;
      onChange({ scale: Math.max(0.05, Math.min(20, d.transform.scale * ratio)) });
    } else {
      const angle = Math.atan2(event.clientY - d.centerScreenY, event.clientX - d.centerScreenX);
      let deg = d.transform.rotation + ((angle - d.startAngle) * 180) / Math.PI;
      // 吸附到 15° 网格
      if (event.shiftKey) deg = Math.round(deg / 15) * 15;
      onChange({ rotation: deg });
    }
  };

  const endDrag = (event: React.PointerEvent): void => {
    if (dragRef.current) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
      // 手势结束：父层据此写一条历史记录。
      onCommit?.();
    }
  };

  // 旋转手柄（顶部中心上方）
  const rotateX = cx;
  const rotateY = cy - hh - ROTATE_OFFSET;

  return (
    <svg
      className="pointer-events-none absolute z-10"
      style={{
        left: box.left - marginCss,
        top: box.top - marginCss,
        width: box.width + marginCss * 2,
        height: box.height + marginCss * 2,
      }}
      viewBox={`${-VIEWBOX_MARGIN} ${-VIEWBOX_MARGIN} ${canvasWidth + VIEWBOX_MARGIN * 2} ${
        canvasHeight + VIEWBOX_MARGIN * 2
      }`}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        {/*
         * 选择框：只画边框，**不拦截指针事件**。
         *
         * ⚠️ 关键：变换框在 `scale=1` 时等于整个画布，若让它吃掉指针事件，
         * 画布上的「点击选中别的片段」就完全失效（点击被手柄层拦截）。
         * 因此框内一律 `pointer-events-none`，由画布自己的命中测试负责点选。
         */}
        <rect
          x={cx - hw}
          y={cy - hh}
          width={hw * 2}
          height={hh * 2}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          className="pointer-events-none"
        />
        {/*
         * 移动抓手：框**边框**上的一条透明宽带（标准剪辑器做法）——
         * 框内点击仍然穿透到画布，边框才是「拖动移动」的把手。
         */}
        <rect
          x={cx - hw}
          y={cy - hh}
          width={hw * 2}
          height={hh * 2}
          fill="none"
          stroke="rgba(59,130,246,0.01)"
          strokeWidth={16}
          className="pointer-events-auto cursor-move"
          onPointerDown={startDrag('move')}
        />
        {/* 四角缩放手柄 */}
        {[
          [cx - hw, cy - hh],
          [cx + hw, cy - hh],
          [cx + hw, cy + hh],
          [cx - hw, cy + hh],
        ].map(([hx, hy]) => (
          <circle
            key={`${hx}-${hy}`}
            cx={hx}
            cy={hy}
            r={HANDLE_R}
            fill="#ffffff"
            stroke="#3b82f6"
            strokeWidth={2}
            className="pointer-events-auto cursor-nwse-resize"
            onPointerDown={startDrag('scale')}
          />
        ))}
        {/* 旋转手柄连线 + 手柄 */}
        <line x1={cx} y1={cy - hh} x2={rotateX} y2={rotateY} stroke="#3b82f6" strokeWidth={2} />
        <circle
          cx={rotateX}
          cy={rotateY}
          r={HANDLE_R + 1}
          fill="#3b82f6"
          stroke="#ffffff"
          strokeWidth={2}
          className="pointer-events-auto cursor-grab"
          onPointerDown={startDrag('rotate')}
        />
      </g>
    </svg>
  );
}

/** 把位置限制在 [0,1]。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
