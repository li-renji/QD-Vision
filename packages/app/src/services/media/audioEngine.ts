/**
 * 预览侧音频引擎。
 *
 * - `AudioContext` 懒创建（首次用户手势后 `resume()`）。
 * - 播放 / 暂停 / 跳转时重建或重启 source 节点，对齐 `currentTimeMs`。
 * - 元素源走 `MediaElementAudioSourceNode` → 混音图。
 */

import type { Clip, ProjectDoc, Track } from '@clipcut/shared-types';
import {
  applyFadeEnvelope,
  buildAudioGraph,
  PITCH_PRESERVE_WORKLET_NAME,
  type AudioGraph,
} from './audioGraph.js';

/** 元素 → MediaElementAudioSourceNode 缓存（一个元素只能创建一次）。 */
const elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/** 预览音频引擎。 */
export class AudioEngine {
  private context: AudioContext | null = null;

  private graph: AudioGraph | null = null;

  private doc: ProjectDoc | null = null;

  private workletLoaded = false;

  private workletFailed = false;

  /** 懒创建 AudioContext。 */
  ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
    }
    return this.context;
  }

  /** 取得（并在需要时恢复）AudioContext。 */
  async resume(): Promise<AudioContext> {
    const context = this.ensureContext();
    if (context.state === 'suspended') {
      await context.resume();
    }
    return context;
  }

  /** 当前 context（未创建时返回 null）。 */
  getContext(): AudioContext | null {
    return this.context;
  }

  /**
   * 加载变速保音高 worklet。
   *
   * 失败时降级为普通 `playbackRate`（音高会变）并标记 `workletFailed`。
   */
  async loadWorklet(moduleUrl: string): Promise<boolean> {
    if (this.workletLoaded) return true;
    if (this.workletFailed) return false;
    try {
      const context = this.ensureContext();
      if (!context.audioWorklet) {
        this.workletFailed = true;
        return false;
      }
      await context.audioWorklet.addModule(moduleUrl);
      this.workletLoaded = true;
      return true;
    } catch {
      this.workletFailed = true;
      return false;
    }
  }

  /** worklet 是否可用。 */
  isWorkletAvailable(): boolean {
    return this.workletLoaded;
  }

  /**
   * 为工程构建混音图。
   *
   * @param doc 工程
   * @param resolveElement 依据 clip 找到对应的媒体元素（视频 / 音频素材）
   */
  buildGraph(
    doc: ProjectDoc,
    resolveElement: (clip: Clip, track: Track) => HTMLMediaElement | null,
  ): AudioGraph {
    const context = this.ensureContext();
    this.doc = doc;

    this.graph?.dispose();

    const graph = buildAudioGraph(context, doc, {
      preservePitch: this.workletLoaded,
      ...(this.workletLoaded ? { workletModuleUrl: this.workletModuleUrl } : {}),
      resolveSource: (clip, track) => {
        const element = resolveElement(clip, track);
        if (!element) return null;
        return this.mediaElementSource(context, element);
      },
    });

    this.graph = graph;
    return graph;
  }

  /** 取得（并缓存）元素的音频源节点。 */
  private mediaElementSource(
    context: AudioContext,
    element: HTMLMediaElement,
  ): MediaElementAudioSourceNode {
    const existing = elementSources.get(element);
    if (existing) return existing;
    const source = context.createMediaElementSource(element);
    elementSources.set(element, source);
    return source;
  }

  /** 应用淡入淡出包络。 */
  applyFade(clip: Clip, gain: GainNode): void {
    if (!this.doc || !this.context) return;
    applyFadeEnvelope(
      gain,
      clip.startMs,
      clip.durationMs,
      clip.audio.fadeInMs,
      clip.audio.fadeOutMs,
      this.context,
    );
  }

  /** 取得主混音总线。 */
  getMasterGain(): GainNode | null {
    return this.graph?.masterGain ?? null;
  }

  /** 释放资源。 */
  dispose(): void {
    this.graph?.dispose();
    this.graph = null;
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
    this.doc = null;
  }

  /** worklet 模块 URL（由外部注入）。 */
  workletModuleUrl: string = '/worklets/pitchPreserveStretchProcessor.js';
}

/** 全局单例。 */
export const audioEngine = new AudioEngine();

/** worklet 名称再导出，便于设置面板展示。 */
export { PITCH_PRESERVE_WORKLET_NAME };
