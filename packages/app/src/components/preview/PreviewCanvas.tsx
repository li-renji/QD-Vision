/**
 * 预览 `<canvas>`：承载合成器输出，支持点击选中画面上的 clip。
 *
 * ## 取帧接线（预览全黑的根因修复）
 *
 * 过去这里调用的是 `renderFrame(ctx, doc, timeMs)` —— **不传 `getFrame`**，
 * 于是 `compositor.drawVideoClip` 在 `if (!getFrame) return;` 处直接返回，
 * 视频图层永不绘制，画布只剩背景色。
 *
 * 现在通过 {@link PreviewFrameSource} 注入 `getFrame`：它在 IndexedDB 里取素材字节
 * → 建 `<video>` / `<img>` → 异步 `createImageBitmap` 写帧缓存，
 * 合成器的**同步** `getFrame` 调用因此能立即拿到 `ImageBitmap`。
 *
 * 该模块是纯服务层，不感知 React；组件只负责生命周期与重绘触发。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Clip, ClipTransform, ProjectDoc } from '@clipcut/shared-types';
import { useProjectStore } from '../../state/projectStore.js';
import {
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  useUiStore,
} from '../../state/uiStore.js';
import { usePlaybackStore } from '../../state/playbackStore.js';
import { renderFrame } from '../../render/compositor.js';
import { useRenderLoop } from '../../hooks/useRenderLoop.js';
import { useElementSize } from '../../hooks/useElementSize.js';
import { usePreviewAudio } from '../../hooks/usePreviewAudio.js';
import { setActivePreviewAudio } from '../../services/media/previewAudio.js';
import { createPreviewFrameSource } from '../../services/media/previewFrameSource.js';
import { getBlobByKey } from '../../services/storage/blobRepo.js';
import { clsx } from '../../utils/clsx.js';
import { setClipTransformForSelected } from '../../state/actions.js';
import { TransformHandles } from './TransformHandles.js';

/** PreviewCanvas 属性。 */
export interface PreviewCanvasProps {
  /** 画布缩放模式。 */
  zoomMode: 'fit' | 'fill' | 'original';
  className?: string;
}

/**
 * 预览画布。
 */
export function PreviewCanvas({ zoomMode, className }: PreviewCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 预览区域容器（监听 Ctrl+滚轮 / 平移手势 + 测量可用空间）。 */
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();
  /** 被缩放变换的舞台（canvas + 手柄叠加层）。 */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const doc = useProjectStore((state) => state.doc);
  const selectedClipIds = useUiStore((state) => state.selectedClipIds);
  const setSelectedClipIds = useUiStore((state) => state.setSelectedClipIds);
  const previewZoom = useUiStore((state) => state.previewZoom);
  const previewPan = useUiStore((state) => state.previewPan);
  const setPreviewZoom = useUiStore((state) => state.setPreviewZoom);
  const setPreviewPan = useUiStore((state) => state.setPreviewPan);

  /**
   * Ctrl+滚轮：以指针为锚点缩放**预览画面**（视图变换，不进工程数据）。
   *
   * 与时间线的缩放同理：React `onWheel` 是被动监听，`preventDefault()`
   * 会被忽略——不挂原生监听器就会变成「缩放整个网页」。
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      const stage = stageRef.current;
      const z = useUiStore.getState().previewZoom;
      const pan = useUiStore.getState().previewPan;
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, z * factor));
      if (next === z) return;
      if (!stage) {
        setPreviewZoom(next);
        return;
      }

      // 锚点数学（transform-origin: 0 0）：
      // 指针下的内容点在缩放后仍留在指针下。
      const rect = stage.getBoundingClientRect();
      const layoutLeft = rect.left - pan.x;
      const layoutTop = rect.top - pan.y;
      const offsetX = (event.clientX - layoutLeft - pan.x) / z;
      const offsetY = (event.clientY - layoutTop - pan.y) / z;
      setPreviewZoom(next);
      setPreviewPan({
        x: event.clientX - layoutLeft - next * offsetX,
        y: event.clientY - layoutTop - next * offsetY,
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef, setPreviewPan, setPreviewZoom]);

  /**
   * 平移手势：中键拖拽，或在**画布外的黑色背景**上左键拖拽。
   * 画布上的左键交互保持原语义（点选 clip / 拖手柄）。
   */
  const panGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onContainerPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const onBackground =
      event.target === event.currentTarget ||
      (event.target as HTMLElement).dataset?.timelineStageBackground === 'true';
    if (event.button !== 1 && !onBackground) return;
    panGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: useUiStore.getState().previewPan.x,
      originY: useUiStore.getState().previewPan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onContainerPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    setPreviewPan({
      x: gesture.originX + (event.clientX - gesture.startX),
      y: gesture.originY + (event.clientY - gesture.startY),
    });
  };

  const onContainerPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (panGestureRef.current?.pointerId === event.pointerId) {
      panGestureRef.current = null;
    }
  };

  /**
   * 预览取帧器：整个组件生命周期内**只创建一次**（StrictMode 下也只创建一次，
   * 避免重复建video 元素与 objectURL）。
   */
  const frameSource = useMemo(
    () =>
      createPreviewFrameSource({
        // 素材字节只走 blobRepo（IndexedDB 封装）—— 组件层不碰 window.indexedDB
        readAssetBlob: (asset) =>
          asset.blobKey ? getBlobByKey(asset.blobKey) : Promise.resolve(null),
      }),
    [],
  );

  /**
   * 当前选中的「主 clip」：画布变换手柄作用于它（多选时取列表第一个）。
   * 所有 clip 都带 `transform`，因此文字 / 字幕 clip 同样可以移动 / 缩放 / 旋转。
   */
  const selectedClip = useMemo(() => {
    const ids = new Set(selectedClipIds);
    for (const track of doc.tracks) {
      const hit = track.clips.find((clip) => ids.has(clip.id));
      if (hit) return hit;
    }
    return null;
  }, [doc.tracks, selectedClipIds]);

  /**
   * 拖拽手柄过程中的**实时预览**变换。
   *
   * 设计要点（与撤销栈铁律一致）：
   * - 拖拽期间只更新本地 state，驱动画布 + 手柄**实时**移动，但**不写历史**；
   * - 整段手势在 `onPointerUp` 时通过 `setClipTransformForSelected` 写**一条**历史记录。
   * 这样既不污染撤销栈（否则每像素一条记录），又让画面跟着手走。
   */
  const [previewTransform, setPreviewTransform] = useState<ClipTransform | null>(null);

  const handleTransformChange = useCallback(
    (patch: Partial<ClipTransform>): void => {
      setPreviewTransform((prev) => {
        const base = prev ?? selectedClip?.transform ?? null;
        if (!base) return prev;
        return { ...base, ...patch };
      });
    },
    [selectedClip],
  );

  const handleTransformCommit = useCallback((): void => {
    if (previewTransform) {
      // 整段手势提交一次，产生一条历史记录。
      setClipTransformForSelected(previewTransform);
    }
    setPreviewTransform(null);
  }, [previewTransform]);

  const draw = useCallback(
    (timeMs: number): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // 拖拽手柄时，把预览变换临时套到选中 clip 上重绘——不进历史，仅实时反馈。
      const source: ProjectDoc =
        previewTransform && selectedClip
          ? applyPreviewTransform(doc, selectedClip.id, previewTransform)
          : doc;
      renderFrame(ctx, source, timeMs, { getFrame: frameSource.getFrame });
    },
    [doc, frameSource, previewTransform, selectedClip],
  );

  /**
   * 预览音频接线（**「没有声音」的修复点**）。
   *
   * 音频复用 `frameSource` 持有的 `<video>` 元素建WebAudio 混音图，
   * 与画面走同一个 `usePlaybackStore` 时钟 —— 见 `usePreviewAudio.ts`。
   */
  const { controller } = usePreviewAudio(frameSource);

  /**
   * 把控制器登记为「当前预览音频」。
   *
   * 播放按钮（`PreviewControls` / `TopToolbar`）需要在**用户手势调用栈内**
   * 调 `unlock()` 才能绕过浏览器自动播放策略；把控制器登记成模块级单例，
   * 按钮就不必层层透传 props。
   */
  useEffect(() => {
    setActivePreviewAudio(controller);
    return () => {
      setActivePreviewAudio(null);
    };
  }, [controller]);

  /**
   * 暴露「当前选中 clip 的 transform」只读快照，供 e2e 断言
   * 「拖动预览窗里的视频确已移动 clip」（否则只能靠像素猜，易 flaky）。
   *
   * 与音频诊断同理：函数体内**现取** store，避免闭包拿到过期快照。
   */
  useEffect(() => {
    const scope = globalThis as typeof globalThis & {
      __clipcutPreviewTransform?: () => {
        clipId: string;
        x: number;
        y: number;
        scale: number;
        rotation: number;
      } | null;
    };
    scope.__clipcutPreviewTransform = () => {
      const { selectedClipIds } = useUiStore.getState();
      const { doc } = useProjectStore.getState();
      const ids = new Set(selectedClipIds);
      for (const track of doc.tracks) {
        const hit = track.clips.find((clip) => ids.has(clip.id));
        if (hit) {
          const tr = hit.transform;
          return { clipId: hit.id, x: tr.x, y: tr.y, scale: tr.scale, rotation: tr.rotation };
        }
      }
      return null;
    };
    return () => {
      delete scope.__clipcutPreviewTransform;
    };
  }, []);

  useRenderLoop({ onFrame: draw });

  // 文档变化时立即重绘一帧
  useEffect(() => {
    draw(usePlaybackStore.getState().currentTimeMs);
  }, [draw]);

  // 素材集合变化 → 登记新素材（异步准备 blob → objectURL → 媒体元素）
  useEffect(() => {
    for (const asset of Object.values(doc.assets)) {
      void frameSource.ensureAsset(asset);
    }
  }, [doc.assets, frameSource]);

  // 异步帧就绪 → 立刻重绘，让新画面马上出现
  useEffect(() => {
    return frameSource.onFrameReady(() => {
      draw(usePlaybackStore.getState().currentTimeMs);
    });
  }, [draw, frameSource]);

  // 播放 / 暂停 / 变速 → 同步到 <video> 元素（命令式，不触发重渲染）。
  // ⚠️ 必须只在**值真正变化**时下发：store 每帧都因 `currentTimeMs` 写回而通知
  // 订阅者，若不加守卫会 60×/秒重复调用 `video.play()` / 重设 `playbackRate`，
  // 反复扰动解码时序，是播放周期性顿挫的直接原因之一。
  useEffect(() => {
    let lastPlaying: boolean | null = null;
    let lastRate = Number.NaN;
    const apply = (state: { isPlaying: boolean; playbackRate: number }): void => {
      if (state.isPlaying !== lastPlaying) {
        lastPlaying = state.isPlaying;
        frameSource.setPlaying(state.isPlaying);
      }
      if (state.playbackRate !== lastRate) {
        lastRate = state.playbackRate;
        frameSource.setPlaybackRate(state.playbackRate);
      }
    };
    apply(usePlaybackStore.getState());
    return usePlaybackStore.subscribe((state) => {
      apply(state);
    });
  }, [frameSource]);

  // 卸载时释放：revokeObjectURL + videoPool.dispose() + close(bitmap)
  useEffect(() => {
    return () => {
      frameSource.dispose();
    };
  }, [frameSource]);

  /** 画面拖拽移动手势进行中的快照（pointerdown 时建立）。 */
  const moveDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startTransform: ClipTransform;
    moved: boolean;
  } | null>(null);

  /** 把一次指针事件的客户端坐标换算成**画布像素坐标**（考虑画布显示缩放）。 */
  const canvasPointFromEvent = (event: {
    clientX: number;
    clientY: number;
  }): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  /** 命中测试：返回指定画布坐标处最上层的 clip（无则 null）。 */
  const findTopClipAt = (x: number, y: number, timeMs: number): Clip | null => {
    const canvasWidth = doc.settings.canvas.width;
    const canvasHeight = doc.settings.canvas.height;
    const candidates = doc.tracks
      .filter((track) => !track.hidden)
      .flatMap((track) => track.clips)
      .filter((clip) => clip.assetId !== null)
      .filter((clip) => timeMs >= clip.startMs && timeMs < clip.startMs + clip.durationMs)
      .sort((a, b) => b.zIndex - a.zIndex);

    for (const clip of candidates) {
      const centerX = clip.transform.x * canvasWidth;
      const centerY = clip.transform.y * canvasHeight;
      const halfWidth = (canvasWidth / 2) * clip.transform.scale;
      const halfHeight = (canvasHeight / 2) * clip.transform.scale;
      if (
        x >= centerX - halfWidth &&
        x <= centerX + halfWidth &&
        y >= centerY - halfHeight &&
        y <= centerY + halfHeight
      ) {
        return clip;
      }
    }
    return null;
  };

  /**
   * 在画布上按下：命中 clip 则**选中它并准备拖拽移动**；未命中则取消选中。
   *
   * 这是「拖动预览窗里的视频来移动它」（剪映式交互）的入口 —— 过去画布上
   * 只有「点击选中」，左键拖动视频本身没有任何效果，用户只能拖选中框的
   * 细边框或去属性面板填数字。现在按住视频拖动即可改 `transform.x/y`。
   */
  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    const point = canvasPointFromEvent(event);
    if (!point) return;
    const timeMs = usePlaybackStore.getState().currentTimeMs;
    const clip = findTopClipAt(point.x, point.y, timeMs);
    if (!clip) {
      setSelectedClipIds([]);
      return;
    }
    setSelectedClipIds([clip.id]);
    moveDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTransform: clip.transform,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = moveDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 位移阈值：低于它视为「点击选中」，不触发移动（避免手抖误移）。
    if (
      !drag.moved &&
      Math.abs(event.clientX - drag.startClientX) + Math.abs(event.clientY - drag.startClientY) < 3
    ) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dx = ((event.clientX - drag.startClientX) * canvas.width) / rect.width;
    const dy = ((event.clientY - drag.startClientY) * canvas.height) / rect.height;
    drag.moved = true;
    // 实时更新本地变换（不进历史），抬起指针时一次性提交。
    setPreviewTransform({
      ...drag.startTransform,
      x: clamp01(drag.startTransform.x + dx / canvas.width),
      y: clamp01(drag.startTransform.y + dy / canvas.height),
    });
  };

  const handleCanvasPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = moveDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    moveDragRef.current = null;
    if (drag.moved && previewTransform) {
      // 整段拖动只提交一条历史记录。
      setClipTransformForSelected(previewTransform);
    }
    setPreviewTransform(null);
  };

  const canvasWidth = doc.settings.canvas.width;
  const canvasHeight = doc.settings.canvas.height;

  /**
   * 画布的**基准显示尺寸**（CSS 像素，未含预览缩放 `previewZoom`）。
   *
   * 按 `zoomMode` 在容器内容区内取一个**保持画布宽高比**的矩形：
   * - `fit`（contain）：能塞进容器的最大同比例矩形（四周留黑边，比例正确）；
   * - `fill`（cover）：铺满容器、等比放大后裁切溢出；
   * - `original`：1 画布像素 = 1 CSS 像素（可平移 / 缩放查看）。
   *
   * 容器尚未测量出尺寸（首帧前）时退回画布原始尺寸，测量后立即纠正。
   * 这一步是「预览按标准比例显示」的关键 —— 过去靠 `object-fit`（对 canvas
   * 无效）+ `max-height:100%`（父高不确定而塌缩）根本约束不住，故显式算。
   */
  const viewW = containerSize.width;
  const viewH = containerSize.height;
  let baseW = canvasWidth;
  let baseH = canvasHeight;
  if (viewW > 0 && viewH > 0) {
    if (zoomMode === 'fill') {
      const scale = Math.max(viewW / canvasWidth, viewH / canvasHeight);
      baseW = canvasWidth * scale;
      baseH = canvasHeight * scale;
    } else if (zoomMode === 'original') {
      baseW = canvasWidth;
      baseH = canvasHeight;
    } else {
      const scale = Math.min(viewW / canvasWidth, viewH / canvasHeight);
      baseW = Math.max(1, canvasWidth * scale);
      baseH = Math.max(1, canvasHeight * scale);
    }
  }

  return (
    <div
      ref={containerRef}
      className={clsx(
        'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-3',
        className,
      )}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      onPointerCancel={onContainerPointerUp}
    >
      {/* 舞台：缩放/平移只作用于这一层，工程数据零改动。
          `w-fit` 让舞台紧贴画布，变换原点才是画布左上角。 */}
      <div
        ref={stageRef}
        className="relative w-fit"
        style={{
          transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
          className="bg-black shadow-lg"
          style={{
            // 显式设定显示宽高：保证画布按标准比例呈现（替代对 canvas 无效的 object-fit）。
            width: `${baseW}px`,
            height: `${baseH}px`,
            // 提示合成层，减少 60fps 重绘时的主线程合成压力
            willChange: 'transform',
          }}
          aria-label="preview"
        />
        {selectedClip ? (
          <TransformHandles
            canvasRef={canvasRef}
            transform={previewTransform ?? selectedClip.transform}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            onChange={handleTransformChange}
            onCommit={handleTransformCommit}
            syncKey={`${previewZoom}:${previewPan.x}:${previewPan.y}:${baseW}:${baseH}`}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * 把一个 clip 的 transform 替换为 `transform`，返回浅克隆的工程文档。
 * 仅用于拖拽手柄时的实时预览重绘，**不**修改 store。
 */
function applyPreviewTransform(
  source: ProjectDoc,
  clipId: string,
  transform: ClipTransform,
): ProjectDoc {
  return {
    ...source,
    tracks: source.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, transform } : clip)),
    })),
  };
}

/** 把归一化位置限制在 [0,1]。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}