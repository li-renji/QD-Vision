/**
 * `usePreviewAudio` —— 把预览音频控制器接到 `PreviewCanvas` 的生命周期上。
 *
 * ## 为什么单独抽一个 hook
 *
 * 音频要跟三件事对齐，缺一不可：
 *
 * 1. **播放状态** —— 跟 `frameSource.setPlaying()` 用**同一个信号**
 *    （`usePlaybackStore`），不另搞一套时钟；
 * 2. **播放头位置** —— 走 `subscribeFrame` 命令式通道（60Hz），
 *    每帧刷新 `clipGain` 的淡入淡出包络；
 * 3. **工程内容** —— clip 增删改 / 轨道静音变化后重建混音图。
 *
 * 放在 hook 里而不是组件里，是为了让接线逻辑可被单测直接覆盖
 * （见 `__tests__/usePreviewAudio.test.ts`）。
 *
 * ## AudioContext 自动播放策略
 *
 * 浏览器要求 `AudioContext` 在**用户手势调用栈内**创建 / 恢复。
 * React 的 `useEffect` 已脱离手势上下文，因此不能只靠 effect ——
 * 必须由播放按钮的 `onClick`（仍在手势内）显式调用 {@link unlock}
 * 见 `PreviewControls.tsx` / `TopToolbar.tsx`。
 *
 * 本 hook 额外注册一个 `pointerdown` 一次性监听做兜底：
 * 用户在编辑器里**任何**一次按下（切面板、拖播放头…）都会解锁 context，
 * 于是「先点播放」不再是唯一入口。此监听挂在 window 上属于浏览器 API 交互，
 * 不涉及文件 / 存储，因此不触犯分层红线（ESLint 规则 A）。
 */

import { useEffect, useMemo, useRef } from 'react';
import type { Clip, Track } from '@clipcut/shared-types';
import { useProjectStore } from '../state/projectStore.js';
import { usePlaybackStore } from '../state/playbackStore.js';
import {
  createPreviewAudio,
  type PreviewAudioController,
  type PreviewAudioDiagnostics,
} from '../services/media/previewAudio.js';
import type { PreviewFrameSource } from '../services/media/previewFrameSource.js';

/** `usePreviewAudio` 返回值。 */
export interface UsePreviewAudioResult {
  /** 控制器（播放按钮需在手势内调用 `unlock()`）。 */
  controller: PreviewAudioController;
  /** 诊断快照读取器（e2e / 设置面板用）。 */
  getDiagnostics: () => PreviewAudioDiagnostics;
}

/**
 * 启动预览音频接线。
 *
 * @param frameSource 取帧器 —— 音频复用它持有的媒体元素
 */
export function usePreviewAudio(frameSource: PreviewFrameSource): UsePreviewAudioResult {
  const doc = useProjectStore((state) => state.doc);

  /**
   * 控制器整个生命周期只创建一次。
   *
   * 理由：`AudioEngine` 持有 `AudioContext` 与 source node 缓存，重建控制器
   * 等于重建 context；元素音频要重新走一遍 `createMediaElementSource`，
   * 代价高且容易在 StrictMode 下抖动。
   */
  const controller = useMemo<PreviewAudioController>(
    () =>
      createPreviewAudio({
        // 复用取帧器已建好的 <video>：同一元素才能命中 source node 缓存
        resolveElement: (clip: Clip, track: Track) => {
          void track; // 元素按 assetId 索引，轨道仅用于将来按轨区分元素
          return clip.assetId === null ? null : frameSource.getElement(clip.assetId);
        },
        // 经由取帧器解除静音 —— 它才是元素池的持有者
        unmuteAsset: (assetId: string) => frameSource.unmute(assetId),
        // 片段倍速 → 元素 playbackRate（配合 preservesPitch 保音高，PRD FR-020③）
        setAssetSpeed: (assetId: string, speed: number) =>
          frameSource.setAssetSpeed(assetId, speed),
      }),
    [frameSource],
  );

  // 工程变化（clip 增删改 / gain / 静音 / 轨道开关）→ 重建混音图
  useEffect(() => {
    controller.sync(doc);
  }, [controller, doc]);

  /**
   * 媒体元素首次就绪 → 重建混音图。
   *
   * 工程刚打开时元素还在异步 `blob → objectURL → loadeddata`，
   * 首个 `sync` 拿到的全是 `null`；等元素就绪必须再补一次，
   * 否则用户会听到「改了东西之后突然有声音」。
   */
  useEffect(() => {
    return frameSource.onElementReady(() => {
      controller.sync(useProjectStore.getState().doc);
    });
  }, [controller, frameSource]);

  // 播放 / 暂停 → 与画面走同一套信号
  const playingRef = useRef<boolean>(false);
  useEffect(() => {
    const apply = (state: { isPlaying: boolean }): void => {
      if (state.isPlaying === playingRef.current) return;
      playingRef.current = state.isPlaying;
      controller.setPlaying(state.isPlaying);
    };
    apply(usePlaybackStore.getState());
    return usePlaybackStore.subscribe(apply);
  }, [controller]);

  // 播放头位置 → 逐帧刷新淡入淡出包络（命令式通道，不触发 React 重渲染）
  useEffect(() => {
    return usePlaybackStore.getState().subscribeFrame((timeMs: number) => {
      controller.setPosition(timeMs);
    });
  }, [controller]);

  /**
   * 手势兜底：任意一次 `pointerdown` 都尝试解锁 AudioContext。
   *
   * 只解锁一次 —— 解锁后浏览器会记住该context已获授权，
   * 重复 `resume()` 既无必要也会在某些实现里抛未捕获的 rejection。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPointerDown = (): void => {
      void controller.unlock();
    };
    window.addEventListener('pointerdown', onPointerDown, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [controller]);

  // 卸载时释放（关闭 AudioContext / 断开混音图）
  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  /**
   * 把诊断抓手挂到 `globalThis`，供 e2e 断言。
   *
   * ## 为什么需要它
   *
   * 预览用的 `<video>` 元素是 `document.createElement('video')` 出来的
   * **游离元素**（不在 DOM 里，也不 `appendChild`）—— 这是离屏取帧的既有设计。
   * 因此 e2e 无法用 `page.locator('video')` 找到它们，也就没法直接断言
   * `video.muted === false`。
   *
   * 于是暴露两个**只读**抓手：
   * - `__clipcutPreviewAudio()`：接线状态快照（context 是否 running、图里有几个 clip…）；
   * - `__clipcutPreviewAudioMaster()`：**主混音总线节点**。e2e 在它上面挂一个
   *   `AnalyserNode`，就能读到**真实时域波形** —— 这是「真的有声音」唯一
   *   客观、直接的证据（恒为 128 即静音）。
   *
   * 用 `globalThis` 而非 `window`：不触犯 ESLint 规则 A（禁止业务层直接
   * 访问 `window` 的文件 / 存储 API），且与浏览器 / Node 环境都兼容。
   */
  useEffect(() => {
    const scope = globalThis as typeof globalThis & {
      __clipcutPreviewAudio?: () => PreviewAudioDiagnostics;
      __clipcutPreviewAudioMaster?: () => GainNode | null;
      __clipcutElementStates?: () => Array<{
        assetId: string;
        preservesPitch: boolean;
        playbackRate: number;
        muted: boolean;
      }>;
    };
    scope.__clipcutPreviewAudio = controller.getDiagnostics;
    scope.__clipcutPreviewAudioMaster = controller.getMasterGainNode;
    /**
     * 媒体元素的运行态（`preservesPitch` / `playbackRate` / `muted`）。
     *
     * e2e 用它断言 PRD FR-020③「音频变速保持音高」—— 元素是游离的
     * （`document.createElement`，不在 DOM 里），`page.locator('video')`
     * 找不到，只能经这里暴露。
     */
    scope.__clipcutElementStates = () => {
      const states: Array<{
        assetId: string;
        preservesPitch: boolean;
        playbackRate: number;
        muted: boolean;
      }> = [];
      for (const assetId of frameSource.getAssetIds()) {
        const element = frameSource.getElement(assetId);
        if (!element) continue;
        states.push({
          assetId,
          preservesPitch: element.preservesPitch,
          playbackRate: element.playbackRate,
          muted: element.muted,
        });
      }
      return states;
    };
    return () => {
      delete scope.__clipcutPreviewAudio;
      delete scope.__clipcutPreviewAudioMaster;
      delete scope.__clipcutElementStates;
    };
  }, [controller, frameSource]);

  return {
    controller,
    getDiagnostics: controller.getDiagnostics,
  };
}