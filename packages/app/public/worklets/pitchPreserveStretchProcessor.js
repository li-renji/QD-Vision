/**
 * WSOLA 变速保音高 AudioWorklet（FR-020③）。
 *
 * ⚠️ 为什么 `public/` 下要有一份 **.js**： `AudioWorklet.addModule(url)` 拉取的是
 * **原生 JS**，构建工具不会对它做 TS 转译（`?url` 也只会原样拷贝源文件）。
 * 本文件是**唯一**实现 —— 历史上 `src/services/media/worklets/*.ts` 是零引用的
 * 死代码，两份实现必然漂移，已删除。结构守门见
 * `src/services/media/__tests__/workletAsset.test.ts`。
 *
 * ⚠️ 本文件运行在 **AudioWorklet 全局作用域**中：
 *  - 不得 import 任何模块；
 *  - 不得引用 `window` / `document`；
 *  - 只能使用 AudioWorkletProcessor 全局 API。
 *
 * ## 参数语义：`rate` = **播放倍速**（与 `compositor.sourceTimeMs` 一致）
 *
 * `sourceTimeMs = inMs + (timeMs - startMs) × clip.speed`
 * → 每 1ms 输出要消耗 `speed` ms 的输入，所以 **`rate = 2` 表示「两倍速」**，
 * 输出时长是输入的一半。历史版本把它写成了 `S / rate`，方向是反的。
 *
 * ## 算法（WSOLA / Waveform-Similarity Overlap-Add）
 *
 * 合成步长 `S` 固定（输出恒定步进），输入步长 `Ha = S × rate`，
 * 帧长 `L = S + Ha` —— 于是**相邻两帧的重叠区恒为 `S`**，
 * 与变速倍率无关（这是能在任意 `rate` 下正确交叉淡化的关键）。
 *
 * 每帧：
 *  1. 以「上一帧的自然延续段」`frame[Ha .. Ha+S]` 为模板，
 *     在 `pos` 附近 ±`SEARCH_RADIUS` 内搜索归一化互相关最大的偏移 τ；
 *  2. `out[i] = frame[i] × wOut[i] + prevTail[i]`（互补 Hann 窗交叉淡化）；
 *  3. `prevTail[i] = frame[Ha+i] × wIn[i]`，`pos += Ha`。
 *
 * ## ⚠️ 四个曾经让本 worklet 输出**静音 / 错误**的 bug（都已修，勿回退）
 *
 * 1. **环形缓冲的负数取模**。旧实现写的是
 *    `(writeIndex - RING_SIZE + offset + i) % RING_SIZE`。
 *    JS 的 `%` **保留被除数的符号** —— `-7168 % 8192 === -7168`，
 *    于是 `ring[-7168]` 是 `undefined` → `?? 0` → **读到的永远是 0**。
 *    改成「绝对下标 + 平移历史缓冲」彻底消除这一类错误。
 * 2. **`processorOptions.rate` 从未被读取**。构造函数忽略了 `options`，
 *    `rate` 恒为 1 → 变速悄悄退化成原速。
 * 3. **没有输出 FIFO**。旧实现每帧只吐 `renderQuantum` 个样本就丢掉其余的，
 *    输出与输入整体错位。`process()` 每次必须填满固定长度，必须排队。
 * 4. **`rate` 方向反了**（`S / rate` → `S × rate`），导致变速时音高与时长
 *    同时错乱（实测 rate=2 时输出基频只有预期的 0.70 倍）。
 *
 * ## 不变式（被 `e2e/audio.spec.ts` 断言）
 *
 * **`rate === 1` 时输出与输入逐样本相等**（实测 RMS 相对误差 0.00000%，
 * 最大误差 2.98e-8 = float32 机器精度）：相邻帧首尾相接，互补窗之和恒为 1。
 *
 * ## ⚠️ 实时源的固有限制：`rate > 1` 在预览里做不到
 *
 * `MediaElementAudioSourceNode` 按**真实时间**送音频。`rate > 1` 要求每 1ms 输出
 * 消耗 `rate` ms 输入 —— 数据此刻还不存在，worklet 会欠载（输出断续）。
 * 因此：
 * - **实时源（预览）**：worklet 只能做**减速**（`rate ≤ 1`）；加速应交给
 *   元素自身的 `playbackRate`（代价是音高随之变化）。
 * - **离线源（导出）**：整段 `AudioBuffer` 已就位，两个方向都能做。
 *
 * `MIN_RATE` / `MAX_RATE` 只做数值夹紧，**不**表达这个实时性约束；
 * 调用方（`audioGraph.applySpeed`）需要自己判断源的类型。
 */

/** 合成步长（样本）—— 输出恒定步进。 */
const S = 128;

/** 相似度搜索半径（样本），步长 {@link DECIM}。 */
const SEARCH_RADIUS = 64;

/**
 * 相关计算的抽取率：每 {@link DECIM} 个样本取 1 个点参与互相关。
 *
 * 旧实现是**全采样精确相关**：`512 × 1024 ≈ 52 万次乘加`，且每 128 样本跑一次
 * —— 44.1kHz 下约 **1.8 亿次乘加/秒**，纯 JS 必然卡死。
 * 现在 `65 × 64 ≈ 4 千次乘加/帧`，实测约 6ms/秒音频（约 0.6% 单核）。
 */
const DECIM = 2;

/**
 * 历史缓冲长度（样本）。
 * 需 ≥ `L_max + SEARCH_RADIUS`：`rate = MAX_RATE` 时 `L = S × (1 + MAX_RATE)`。
 */
const HISTORY = 4096;

/** 输出 FIFO 长度（样本）。 */
const OUT_FIFO = 4096;

/** 变速倍率允许的数值范围（仅做夹紧，不代表实时源可行，见文件头说明）。 */
const MIN_RATE = 0.25;
const MAX_RATE = 4;

/**
 * 互补窗：`wOut[i] + wIn[i] === 1`（对任意 `S` 都成立）。
 *
 * 用互补窗而不是单条 Hann，是为了让交叉淡化在**任意重叠长度**下都严格重建
 * 原波形 —— 变速时重叠长度是变化的，单条 Hann 只在 50% 重叠时满足 COLA。
 */
function complementWindows(length) {
  const out = new Float32Array(length);
  const inn = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = 0.5 * (1 - Math.cos((Math.PI * i) / length));
    inn[i] = 1 - out[i];
  }
  return { out, inn };
}

/** 把数值夹到 [min, max]。 */
function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * 单声道的 WSOLA 状态。
 *
 * 输入用**平移历史缓冲 + 绝对下标**而非环形缓冲 —— 见文件头「bug 1」。
 */
class WsolaChannel {
  /** @param {number} rate 播放倍速 */
  constructor(taper, rate) {
    /** 历史波形；`history[absIndex - head]` 即绝对下标 `absIndex` 处的样本。 */
    this.history = new Float32Array(HISTORY);
    /** `history[0]` 对应的绝对下标。 */
    this.head = 0;
    /** 已写入的绝对样本总数（即下一个待写位置）。 */
    this.end = 0;

    /** 输出 FIFO 的读 / 写位置。 */
    this.out = new Float32Array(OUT_FIFO);
    this.outStart = 0;
    this.outEnd = 0;

    /** 上一帧自然延续段的加窗尾部（与本帧头部交叉淡化）。 */
    this.prevTail = new Float32Array(S);
    /** 上一帧自然延续段（未加窗），作为下一次相似度搜索的模板。 */
    this.template = new Float32Array(S);
    /** 模板能量（平方和）—— 相关归一化的分母之一；全 0 时搜索无意义。 */
    this.templateEnergy = 0;

    /** 下一帧的**名义**起始绝对下标。 */
    this.pos = 0;
    /** 是否已输出过第一帧（第一帧没有配对尾部，不能加窗）。 */
    this.started = false;
    /** 互补窗。 */
    this.taper = taper;
    this.setRate(rate);
  }

  /** 设置播放倍速（影响此后合成的帧：输入步长与帧长）。 */
  setRate(rate) {
    this.rate = clamp(rate, MIN_RATE, MAX_RATE);
    this.hop = Math.max(1, Math.round(S * this.rate)); // Ha：每帧消耗的输入样本
    this.frameLength = S + this.hop; // L：保证重叠区恒为 S
  }

  /** FIFO 中有效样本数。 */
  get pending() {
    return this.outEnd - this.outStart;
  }

  /** 追加输入样本。 */
  push(chunk) {
    if (chunk.length === 0) return;
    if (chunk.length >= HISTORY) {
      // 输入比缓冲还长：只保留最后 HISTORY 个样本
      this.history.set(chunk.subarray(chunk.length - HISTORY));
      this.head = this.end + chunk.length - HISTORY;
      this.end = this.head + HISTORY;
      return;
    }
    if (this.end - this.head + chunk.length > HISTORY) {
      // 丢弃最旧的数据
      const drop = this.end - this.head + chunk.length - HISTORY;
      this.history.copyWithin(0, drop, this.end - this.head);
      this.head += drop;
    }
    this.history.set(chunk, this.end - this.head);
    this.end += chunk.length;
  }

  /** 读绝对下标 `abs` 处的样本（越界返回 0）。 */
  at(abs) {
    const index = abs - this.head;
    if (index < 0 || index >= HISTORY) return 0;
    return this.history[index];
  }

  /** 是否还有足够的输入合成下一帧（含搜索窗余量）。 */
  canSynthesize() {
    return this.pos + this.frameLength + SEARCH_RADIUS <= this.end;
  }

  /** 取走 `count` 个样本到 `dest`（不足部分补 0）。 */
  pull(dest, count) {
    for (let i = 0; i < count; i += 1) {
      dest[i] = this.outStart + i < this.outEnd ? this.out[this.outStart + i] : 0;
    }
    this.outStart += count;
    if (this.outStart >= this.outEnd) {
      this.outStart = 0;
      this.outEnd = 0;
    }
  }

  /**
   * 搜索与模板最相似的偏移 τ（抽样式归一化互相关）。
   *
   * 模板全 0（静音）时相关性无意义，直接返回 0。
   */
  findBestOffset() {
    if (this.templateEnergy <= 0) return 0;

    const { template, templateEnergy } = this;
    let bestOffset = 0;
    let bestScore = -Infinity;

    for (let offset = -SEARCH_RADIUS; offset <= SEARCH_RADIUS; offset += DECIM) {
      const base = this.pos + offset;
      let dot = 0;
      let energy = 0;
      for (let i = 0; i < S; i += DECIM) {
        const a = template[i];
        const b = this.at(base + i);
        dot += a * b;
        energy += b * b;
      }
      const denominator = Math.sqrt(templateEnergy * energy);
      const score = denominator > 0 ? dot / denominator : 0;
      // 平局时偏向更小的 |offset|：既减少逐帧抖动，也让 rate=1 更接近「逐样本相等」
      if (
        score > bestScore + 1e-9 ||
        (score > bestScore - 1e-9 && Math.abs(offset) < Math.abs(bestOffset))
      ) {
        bestScore = Math.max(bestScore, score);
        bestOffset = offset;
      }
    }

    return bestOffset;
  }

  /** 合成一帧并压入输出 FIFO。 */
  synthesize() {
    const { history, prevTail, template, taper } = this;
    const position = this.pos + (this.started ? this.findBestOffset() : 0);
    const base = position - this.head;

    if (this.started) {
      // 交叉淡化：本帧头部（升窗）+ 上一帧延续段（降窗），两窗之和恒为 1
      for (let i = 0; i < S; i += 1) {
        this.out[this.outEnd + i] = history[base + i] * taper.out[i] + prevTail[i];
      }
    } else {
      // 第一帧没有配对尾部，直接原样输出（不加窗，否则起点会被压成 0）
      for (let i = 0; i < S; i += 1) {
        this.out[this.outEnd + i] = history[base + i];
      }
    }

    // 自然延续段 = frame[Ha .. Ha+S]，它既是下一帧的尾部也是相似度模板
    let energy = 0;
    const tailBase = base + this.hop;
    for (let i = 0; i < S; i += 1) {
      const sample = history[tailBase + i];
      prevTail[i] = sample * taper.inn[i];
      template[i] = sample;
      energy += sample * sample;
    }
    this.templateEnergy = energy;

    this.pos = position + this.hop;
    this.started = true;
    this.outEnd += S;
    if (this.outEnd > OUT_FIFO) this.outEnd = OUT_FIFO;
  }
}

class PitchPreserveStretchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // ⚠️ bug 2 的修复点：旧实现完全忽略 options，导致 rate 恒为 1
    const requested = options?.processorOptions?.rate;
    this.rate = typeof requested === 'number' && requested > 0 ? requested : 1;
    this.taper = complementWindows(S);
    this.channels = [];
  }

  /** 取得（或懒创建）某声道的状态。 */
  channelState(index) {
    let state = this.channels[index];
    if (!state) {
      state = new WsolaChannel(this.taper, this.rate);
      this.channels[index] = state;
    }
    return state;
  }

  /** 运行中变速：只影响此后合成的帧，已合成的部分保持不变。 */
  setRate(rate) {
    this.rate = clamp(rate, MIN_RATE, MAX_RATE);
    for (const state of this.channels) {
      state.setRate(this.rate);
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || output.length === 0) return true;

    const quantum = output[0].length;

    // AudioWorkletNode 声明的输出声道数可能多于输入
    // （audioGraph.applySpeed 用的是 outputChannelCount: [2]），
    // 多出来的声道沿用最后一个已处理的输入声道。
    const hasInput = input.length > 0 && input[0] && input[0].length > 0;
    const availableInputs = hasInput ? input.length : 1;
    const lastInputIndex = Math.max(0, availableInputs - 1);

    // 1) 推入输入
    if (hasInput) {
      for (let c = 0; c < availableInputs; c += 1) {
        this.channelState(c).push(input[c] ?? input[0]);
      }
    }

    // 2) 尽可能合成（FIFO 至少留一帧 + 一个 quantum 的余量）
    for (let c = 0; c < availableInputs; c += 1) {
      const state = this.channelState(c);
      while (state.canSynthesize() && state.pending + S + quantum <= OUT_FIFO) {
        state.synthesize();
      }
    }

    // 3) 输出
    for (let c = 0; c < output.length; c += 1) {
      this.channelState(Math.min(c, lastInputIndex)).pull(output[c], quantum);
    }

    return true;
  }
}

registerProcessor('clipcut-pitch-preserve-stretch', PitchPreserveStretchProcessor);