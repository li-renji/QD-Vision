/**
 * 离线混音渲染（**导出音频的唯一来源**，FR-035 / FR-039）。
 *
 * ## 为什么需要这个模块
 *
 * `webCodecsExporter.ts` 的 `RenderOptions` 早就预留了 `audioBuffer: AudioBuffer | null`，
 * 但**从来没有生产方** —— 调用方一律传 `null`，于是
 * `if (options.audioCodec && options.audioBuffer)` 这个分支**永不执行**，
 * 导出结果是**静音 MP4**。本模块补上这块缺失的拼图。
 *
 * ## 为什么不能直接复用预览侧的代码
 *
 * 预览侧用 `MediaElementAudioSourceNode`（HTML `<video>` / `<audio>` 元素）作为音源，
 * 而**离线渲染里没有元素可用** —— 必须改成
 * 「`decodeAudioData` → `AudioBuffer` → `createBufferSource()`」。
 *
 * 另外 `decodeAudioData` 是**异步**的，而 `audioGraph.buildAudioGraph` 的
 * `resolveSource` 是**同步**回调。解决办法（方案 A）：
 *
 * ```
 * ① 异步：把所有用到的素材解码成 AudioBuffer，缓存进 Map
 * ② 同步：buildAudioGraph(context, doc, { resolveSource }) —— 此时 resolveSource
 *         直接从缓存里同步取 AudioBuffer 并建 AudioBufferSourceNode
 * ```
 *
 * 这样**混音拓扑**（增益、淡入淡出、静音规则）仍然只有 `audioGraph.ts` 一份实现，
 * 预览与导出不会长出「两套约束」（FR-035① 所��即所得）。
 *
 * ## 时间映射（本模块最容易出错的地方）
 *
 * 每个片段涉及三个时间概念：
 *
 * | 概念 | 字段 | 含义 |
 * |---|---|---|
 * | 源入点 | `clip.inMs` | 从素材的哪一刻开始取 |
 * | 源出点 | `clip.outMs` | 取到素材的哪一刻 |
 * | 时间线位置 | `clip.startMs` | 放在时间线的哪里 |
 * | 时间线时长 | `clip.durationMs` | 在时间线上占多长（**已含变速**） |
 *
 * 项目核心不变式（`docs/PRD.md`）：
 *
 * ```
 * durationMs === Math.round((outMs - inMs) / speed)
 * ```
 *
 * 因此：
 * - `start(whenSec, offsetSec)`：`whenSec = startMs/1000`（**时间线**时间），
 *   `offsetSec = inMs/1000`（**素材**时间）；
 * - `playbackRate.value = speed`；
 * - `start()` 的第三个参数 `duration` 按 WebAudio 规范是**素材时长**
 *   （`durationSec = (outMs - inMs)/1000`），会被 `playbackRate` 拉伸；
 * - 额外再调一次 `stop(stopSec)`，`stopSec` 是**时间线**时间 ——
 *   这样即便某个浏览器把 `duration` 当成播放时长，播放区间也不会溢出。
 *
 * 详见 {@link resolveClipScheduling}。
 *
 * ## 已知限制：变速会变调（**已实测，不是拍脑袋**）
 *
 * 本模块的变速走**纯 `playbackRate`**（`audioGraph.applySpeed` 在
 * `preservePitch: false` 时就是这个行为），因此导出的变速音频**无法保音高**。
 *
 * ### 为什么不用保音高 worklet（Chromium 131 实测结论）
 *
 * 曾评估过把 `public/worklets/pitchPreserveStretchProcessor.js` 接进导出路径，
 * 实测**否掉了**（探针：源为「每秒幅度 0.1/0.2/0.3 的阶梯」与「440Hz 正弦」，
 * 在 `OfflineAudioContext` 里渲染后测输出的幅度画像与过零频率）：
 *
 * | rate | 输出有声时长 | 幅度阶梯落点 | 440Hz 正弦的输出频率 |
 * |---|---|---|---|
 * | 1 | 3.000s（= 源长） | 1s / 2s（**1×**） | 440 Hz（逐样本透明，误差 7.45e-9） |
 * | 0.5 | 3.008s（= 源长） | 1s / 2s（**1×**） | **592.35 Hz** |
 * | 2 | 2.997s（= 源长） | 1s / 2s（**1×**） | **312.55 Hz**（= 0.71×） |
 *
 * 也就是说：**`rate` 对输出没有任何影响**（连源循环播放也一样），
 * 音高反而被搅乱（440 → 592 / 312 Hz）。
 *
 * 根因（读 `pitchPreserveStretchProcessor.js` 可复核）：
 * `process()` 里的合成循环是「**贪心填满输出 FIFO**」
 * （`while (canSynthesize() && pending + S + quantum <= OUT_FIFO) synthesize()`），
 * 于是每个输出 quantum 总是产出**整数倍**的帧，
 * 素材消耗速率恒等于输入到达速率（1×）—— `hop` 只影响「每帧吃多少素材」，
 * 不影响「素材多久被读完」⇒ **内容推进速率恒为 1×**。
 * WSOLA 要真正变速，合成必须**按输出速率配速**（每 quantum 合成固定帧数）。
 *
 * 另有一条**架构性**限制（与配速无关）：WSOLA 作为**流式**处理器，
 * 「加速」需要尚未到达的素材（「数据此刻还不存在」），
 * 「减速」则要求素材在输出窗口内持续供应 ——
 * 而离线渲染里素材是**有限 AudioBuffer**，`AudioBufferSourceNode` 播完就没了，
 * 减速时素材的尾巴会丢。
 *
 * ⇒ 结论：**导出路径不挂 worklet**，用纯 `playbackRate`。
 * 时长是对的（音画同步），代价只是音高随变速变化 ——
 * 这与预览侧「加速交给元素 `playbackRate`」的行为一致。
 *
 * 无论原因如何，**都必须告知用户**（PRD §9.0.1 准则四「静默即等于关闭警报」）——
 * 因此本模块会在 {@link OfflineMixResult.warnings} 里给出显式提示。
 *
 * @module services/export/offlineAudioRenderer
 */

import type { Clip, ProjectDoc } from '@clipcut/shared-types';
import {
  applyFadeEnvelope,
  buildAudioGraph,
  mixDurationMs,
  mixableTracks,
} from '../media/audioGraph.js';
import { BlobKeys } from '../storage/db.js';
import { getBlobByKey } from '../storage/blobRepo.js';

/** 默认采样率（与 `exportPlan.audio.sampleRate` 保持一致）。 */
export const DEFAULT_OFFLINE_SAMPLE_RATE = 48_000;

/** 默认声道数（与 `exportPlan.audio.channels` 保持一致）。 */
export const DEFAULT_OFFLINE_CHANNEL_COUNT = 2;

/** 主音量上限（与预览侧 `previewAudio.MAX_MASTER_GAIN` 一致）。 */
export const MAX_MASTER_GAIN = 2;

/**
 * 片段在离线渲染中的排程（**纯函数**产物，可直接单测）。
 *
 * 全部时间单位为**秒**。
 */
export interface ClipScheduling {
  /** 时间线上的播放起点（context 时间轴）。 */
  whenSec: number;
  /** 素材内偏移（`start()` 的 `offset` 参数，**素材时间**）。 */
  offsetSec: number;
  /** 素材侧时长（`start()` 的 `duration` 参数，**素材时间**，会被 `playbackRate` 拉伸）。 */
  durationSec: number;
  /** 播放速率（`clip.speed`）。 */
  playbackRate: number;
  /** 时间线侧时长（`clip.durationMs / 1000`）。 */
  timelineDurationSec: number;
  /** 停止时刻（`stop()` 的参数，**context 时间轴**）。 */
  stopSec: number;
}

/**
 * 计算一个片段的离线排程（**纯函数**，不碰任何 WebAudio 对象）。
 *
 * ## 三条不变式
 *
 * 1. `whenSec = clip.startMs / 1000` —— 播放起点落在时间线的哪一刻。
 * 2. `offsetSec = clip.inMs / 1000` —— 从素材的哪一刻开始取。
 * 3. `stopSec - whenSec === clip.durationMs / 1000`（当工程满足
 *    `durationMs === round((outMs - inMs) / speed)` 时）—— 播放区间与
 *    时间线上的片段**等长**，音画因此同步。
 *
 * ## `duration` 参数是「素材时长」还是「播放时长」
 *
 * 按 WebAudio 规范，`AudioBufferSourceNode.start(when, offset, duration)` 的
 * `duration` **在素材的时间坐标系里度量**，因此会被 `playbackRate` 拉伸：
 * `duration = 3` 秒的素材在 `playbackRate = 2` 时只占 1.5 秒的 context 时间。
 *
 * 本函数因此把 `durationSec`（素材时长）交给 `start()`，同时**额外**用
 * `stopSec`（context 时间）兜底 —— 这样无论浏览器如何解释 `duration`，
 * 播放区间都恰好是时间线上的那一段。
 */
export function resolveClipScheduling(clip: Clip): ClipScheduling {
  const playbackRate = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  const whenSec = Math.max(0, clip.startMs) / 1000;
  const offsetSec = Math.max(0, clip.inMs) / 1000;
  const durationSec = Math.max(0, clip.outMs - clip.inMs) / 1000;
  const timelineDurationSec = Math.max(0, clip.durationMs) / 1000;

  // 停止时刻取「时间线时长」与「素材能支撑的时长」的**较小者**：
  // - 工程满足不变式时两者相等；
  // - 万一不变式被破坏（例如外部导入了非法工程），也不会把素材之外的
  //   声音拖进成片。
  const stopSec = whenSec + Math.min(timelineDurationSec, durationSec / playbackRate);

  return {
    whenSec,
    offsetSec,
    durationSec,
    playbackRate,
    timelineDurationSec,
    stopSec,
  };
}

/**
 * 工程是否**含有应该发声的音频**（纯函数）。
 *
 * 判定复用 `audioGraph.mixDurationMs` —— 它与 `audioGraph.buildAudioGraph`
 * 由**同一处静音规则**驱动（轨道静音 / 片段静音 / 隐藏的音频轨），
 * 因此这里不会与真正的混音图产生「两套约束」。
 *
 * 导出流程据此区分两种「没有声音」：
 * - `false` —— 用户本来就没放音频，导出静音是**预期结果**，不告警；
 * - `true`  —— 用户放了音频却没渲染出来，**必须告警**（PRD §9.0.1 准则四）。
 */
export function hasAudibleAudio(doc: ProjectDoc): boolean {
  if (mixDurationMs(doc) <= 0) return false;
  return collectMixableAssetIds(doc).length > 0;
}

/**
 * 收集**可能参与混音的素材 id**（去重，纯函数）。
 *
 * 这里刻意取「所有 mixable 轨道（视频轨 + 音频轨）上的素材」这一**超集**：
 * - 多解一个码只是浪费一点时间；
 * - 而**漏解**一个素材会让成片**丢声音**（严重得多）。
 *
 * 真正参与混音的片段由 `buildAudioGraph` 决定（静音规则在它那里，本模块不重复实现）。
 */
export function collectMixableAssetIds(doc: ProjectDoc): string[] {
  const ids = new Set<string>();
  for (const track of mixableTracks(doc)) {
    for (const clip of track.clips) {
      if (clip.assetId === null) continue;
      ids.add(clip.assetId);
    }
  }
  return [...ids];
}

/**
 * 解析主音量（纯函数）。
 *
 * 与预览侧 `previewAudio.resolveMasterGain` 保持同一取值口径：
 * 读 `doc.settings.masterGain`（**可选**字段，缺省为 1），并夹紧到 `[0, 2]`。
 *
 * @see 单元测试 `offlineAudioRenderer.test.ts` 里的「与预览侧口径一致」用例，
 *      那里直接调用预览侧的实现做交叉校验，防止两边漂移。
 */
export function resolveExportMasterGain(doc: ProjectDoc): number {
  const raw = (doc.settings as { masterGain?: unknown }).masterGain;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.max(0, Math.min(MAX_MASTER_GAIN, raw));
}

/** 离线渲染上下文（`OfflineAudioContext` 的最小结构）。 */
export type OfflineRenderContext = BaseAudioContext & {
  startRendering(): Promise<AudioBuffer>;
};

/** 离线混音渲染参数。 */
export interface OfflineMixOptions {
  /**
   * 读取素材字节。
   *
   * 默认实现从 IndexedDB 读原始素材（`blob:<assetId>`）。
   * 测试可注入假实现，避免依赖真实数据库。
   */
  readAssetBytes?: (assetId: string) => Promise<ArrayBuffer | null>;
  /** 创建离线上下文（测试注入用）。 */
  createOfflineContext?: (
    channels: number,
    length: number,
    sampleRate: number,
  ) => OfflineRenderContext;
  /** 采样率（默认 48000）。 */
  sampleRate?: number;
  /** 声道数（默认 2）。 */
  channelCount?: number;
  /** 取消信号。 */
  signal?: AbortSignal;
}

/** 离线混音结果。 */
export interface OfflineMixResult {
  /** 渲染出的混音；无可听音频或渲染失败时为 `null`。 */
  buffer: AudioBuffer | null;
  /** 告警（必须让用户看见 —— PRD §9.0.1 准则四）。 */
  warnings: string[];
  /** 工程是否**含有应该发声**的片段。 */
  hasAudibleClips: boolean;
  /** 实际进入混音图的片段数。 */
  mixedClipCount: number;
  /** 渲染结果是否完全静音。 */
  silent: boolean;
  /** 渲染结果的峰值幅度（0~1）。 */
  peak: number;
}

/**
 * 计算 `AudioBuffer` 的峰值幅度（纯函数）。
 *
 * 这是「导出的文件里到底有没有声音」最直接的客观证据：
 * 峰值恒为 0 ⇒ 输出静音。
 */
export function peakAmplitude(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const value = Math.abs(data[index] ?? 0);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

/** 默认的离线上下文工厂（浏览器环境）。 */
function defaultCreateOfflineContext(
  channels: number,
  length: number,
  sampleRate: number,
): OfflineRenderContext {
  const ctor = (
    globalThis as {
      OfflineAudioContext?: new (
        numberOfChannels: number,
        length: number,
        sampleRate: number,
      ) => OfflineRenderContext;
    }
  ).OfflineAudioContext;
  if (!ctor) {
    throw new Error('当前浏览器不支持 OfflineAudioContext');
  }
  return new ctor(channels, length, sampleRate);
}

/**
 * 默认的素材字节读取（IndexedDB → 原始素材 blob）。
 *
 * ⚠️ 这里走的是 `services/storage/blobRepo.ts` 的抽象，
 * **没有**直接碰 `window.indexedDB`（ESLint 规则 A 的白名单只放行
 * `services/storage/db.ts`）。
 */
async function readAssetBytesFromDb(assetId: string): Promise<ArrayBuffer | null> {
  const blob = await getBlobByKey(BlobKeys.asset(assetId));
  if (!blob) return null;
  return await blob.arrayBuffer();
}

/** 把任意异常转成可读文案。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 渲染整条时间线的混音（**离线**，无实时约束）。
 *
 * ## 流程
 *
 * ```
 * ① 收集应该发声的片段（静音规则与预览完全一致）
 * ② 创建 OfflineAudioContext（长度 = 工程时长）
 * ③ 异步解码所有素材 → Map<assetId, AudioBuffer>
 * ④ buildAudioGraph(...) —— resolveSource 从缓存同步取 AudioBuffer
 *    · source.playbackRate = speed
 *    · source.start(when, offset, duration) + source.stop(stop)
 *    · 包络节点承载淡入淡出（绝对时间轴 → 离线渲染天然正确）
 * ⑤ masterGain = 主音量
 * ⑥ startRendering() → AudioBuffer
 * ⑦ 峰值检测（静音判定）+ 告警汇总
 * ```
 *
 * ## 失败语义
 *
 * **绝不静默**：只要工程「含有应该发声的音频」而本函数没能产出 `buffer`，
 * `warnings` 里一定有明确的说明，由调用方（`exportController`）呈现给用户。
 */
export async function renderOfflineMix(
  doc: ProjectDoc,
  options: OfflineMixOptions = {},
): Promise<OfflineMixResult> {
  const warnings: string[] = [];
  const hasAudible = hasAudibleAudio(doc);
  const assetIds = collectMixableAssetIds(doc);

  // ---- ① 工程本来就没有音频：不渲染、不告警（静音是预期结果）----
  if (!hasAudible || assetIds.length === 0) {
    return {
      buffer: null,
      warnings,
      hasAudibleClips: false,
      mixedClipCount: 0,
      silent: true,
      peak: 0,
    };
  }

  const sampleRate = options.sampleRate ?? DEFAULT_OFFLINE_SAMPLE_RATE;
  const channelCount = options.channelCount ?? DEFAULT_OFFLINE_CHANNEL_COUNT;
  const durationMs = Math.max(mixDurationMs(doc), Math.round(doc.meta.durationMs));
  const length = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));

  // ---- ② 离线上下文 ----
  let context: OfflineRenderContext;
  try {
    const factory = options.createOfflineContext ?? defaultCreateOfflineContext;
    context = factory(channelCount, length, sampleRate);
  } catch (error) {
    warnings.push(
      `当前浏览器不支持离线音频渲染（OfflineAudioContext），导出结果将不含音频。${describeError(error)}`,
    );
    return {
      buffer: null,
      warnings,
      hasAudibleClips: true,
      mixedClipCount: 0,
      silent: true,
      peak: 0,
    };
  }

  // ---- ③ 异步预解码（decodeAudioData 是异步的，必须先解码再同步建图）----
  const readAssetBytes = options.readAssetBytes ?? readAssetBytesFromDb;
  const decoded = new Map<string, AudioBuffer | null>();
  const failedAssets: string[] = [];

  for (const assetId of assetIds) {
    if (options.signal?.aborted) {
      throw new DOMException('导出已取消', 'AbortError');
    }

    let sourceBuffer: AudioBuffer | null = null;
    try {
      const bytes = await readAssetBytes(assetId);
      if (bytes) {
        sourceBuffer = await context.decodeAudioData(bytes);
      }
    } catch {
      sourceBuffer = null;
    }

    decoded.set(assetId, sourceBuffer);
    if (!sourceBuffer) failedAssets.push(assetId);
  }

  if (failedAssets.length > 0) {
    warnings.push(
      `有 ${failedAssets.length} 个素材无法解码音频（浏览器可能不支持该封装格式），` +
        `导出结果将缺少这些素材的声音：${failedAssets.join('、')}。`,
    );
  }

  // ---- ④ 建图（同步；resolveSource 从缓存取）----
  let graph: ReturnType<typeof buildAudioGraph>;
  try {
    graph = buildAudioGraph(context, doc, {
      // ⚠️ 显式关闭保音高变速。
      // 实测（见文件头「已知限制」）：WSOLA worklet 在离线渲染里 `rate` 对输出
      // **没有任何影响**（内容推进速率恒为 1×，音高反而被搅乱），
      // 因此导出路径不挂它 —— 时长正确、音高随变速变化，与预览侧加速行为一致。
      preservePitch: false,
      resolveSource: (clip) => {
        const assetId = clip.assetId;
        if (!assetId) return null;
        const sourceBuffer = decoded.get(assetId);
        if (!sourceBuffer) return null;

        const scheduling = resolveClipScheduling(clip);

        const source = context.createBufferSource();
        source.buffer = sourceBuffer;
        // 变速必须在**素材源**上设置。
        // （`buildAudioGraph` 内部的 `applySpeed` 拿到的是下面返回的包络节点 ——
        //   GainNode 没有 `playbackRate`，那一步是空操作，因此由这里负责。）
        source.playbackRate.value = scheduling.playbackRate;
        // `duration` 是**素材时长**；`stop` 是**时间线时间**，两者互为兜底。
        source.start(scheduling.whenSec, scheduling.offsetSec, scheduling.durationSec);
        source.stop(scheduling.stopSec);

        // 包络节点：承载淡入淡出。
        // `applyFadeEnvelope` 用的是**绝对时间轴**（`setValueAtTime(t, startMs/1000)`），
        // 在离线上下文里 context 时间 == 时间线时间，包络因此天然正确。
        // 片段自身的音量由 `buildAudioGraph` 建的 clipGain 承担（`clip.audio.gain`），
        // 两者相乘 = `clip.audio.gain × 淡入淡出曲线`，与预览侧口径一致。
        const envelope = context.createGain();
        envelope.gain.value = 1;
        source.connect(envelope);
        applyFadeEnvelope(
          envelope,
          clip.startMs,
          clip.durationMs,
          clip.audio.fadeInMs,
          clip.audio.fadeOutMs,
          clip.audio.envelope,
          context,
        );
        return envelope;
      },
    });
  } catch (error) {
    warnings.push(`离线混音建图失败：${describeError(error)}。导出结果将不含音频。`);
    return {
      buffer: null,
      warnings,
      hasAudibleClips: true,
      mixedClipCount: 0,
      silent: true,
      peak: 0,
    };
  }

  // ---- ⑤ 主音量 ----
  graph.masterGain.gain.value = resolveExportMasterGain(doc);

  // ---- ⑥ 渲染 ----
  let buffer: AudioBuffer;
  try {
    buffer = await context.startRendering();
  } catch (error) {
    graph.dispose();
    warnings.push(`离线混音渲染失败：${describeError(error)}。导出结果将不含音频。`);
    return {
      buffer: null,
      warnings,
      hasAudibleClips: true,
      mixedClipCount: 0,
      silent: true,
      peak: 0,
    };
  }

  const mixedClipCount = graph.clipGains.size;
  // 真正进入混音图的片段 id —— 静音规则由 `buildAudioGraph` 决定，本模块不重复实现。
  const mixedClipIds = new Set(graph.clipGains.keys());
  graph.dispose();

  // ---- ⑦ 静音检测与告警汇总 ----
  const peak = peakAmplitude(buffer);
  const silent = peak <= 0;
  if (silent) {
    warnings.push('混音结果为静音（所有样本均为 0），导出结果将没有声音。');
  }

  const speedChanged = doc.tracks
    .flatMap((track) => track.clips)
    .filter((clip) => mixedClipIds.has(clip.id) && clip.speed !== 1);
  if (speedChanged.length > 0) {
    warnings.push(
      `有 ${speedChanged.length} 个变速片段在导出时未启用保音高变速（离线混音走纯 playbackRate），` +
        `成片声音会变调，与预览可能不同。`,
    );
  }

  return {
    buffer,
    warnings,
    hasAudibleClips: true,
    mixedClipCount,
    silent,
    peak,
  };
}
