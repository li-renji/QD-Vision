/**
 * WSOLA 变速保音高 AudioWorklet（FR-020③）。
 *
 * ⛔ **已停用（2026-10-23）** —— 本文件**不再被应用挂载**。
 *
 * 架构决策见 `packages/app/src/services/media/audioGraph.ts` 的 `applySpeed`：
 * 变速只做一次，由音频源自身的 `playbackRate` 承担
 * （预览侧用元素的 `preservesPitch`，导出侧用 `AudioBufferSourceNode.playbackRate`）。
 *
 * 三条实测结论（别再修一遍）：
 *
 * 1. **WSOLA 是「时间伸缩」：改时长、保音高。它不能「还原音高」。**
 *    `rate: 1` 时它是恒等变换（逐样本还原，误差 7.45e-9）。
 *    想「playbackRate 变速 + 补偿音高」需要 pitch shifter（PSOLA / 相位声码器），
 *    是另一个算法，不是加个 `pitchScale` 参数。
 * 2. **有界缓冲的流式处理器做不了时间伸缩。** 减速（`rate < 1`）时
 *    「已到达但未消费」的素材积压**无界增长**，固定缓冲必然被冲掉；
 *    加速（`rate > 1`）则需要**尚未到达**的素材。
 *    Node 逐量子实测（3 秒脉冲素材、rate=0.5）：
 *
 *    | HISTORY | 结果 |
 *    |---|---|
 *    | 4096（85ms） | 1 个脉冲、输出 41ms —— **垃圾**（读取位置掉出缓冲 → 负下标） |
 *    | 65536（1.36s） | 3 个脉冲、间隔 **0.9987s** —— **正确** |
 *
 *    ⇒ 缓冲越大能拉伸的素材越长，但积压仍无界 ⇒ 更长素材照样崩。
 * 3. 实测本 worklet 的 `rate` 对输出**没有任何影响**（rate=0.5/1/2 输出逐样本相同）
 *    ⇒ 拆挂载是**行为中性**的。
 *
 * 若将来要「离线保音高变速」，正确做法是把 WSOLA 做成
 * **对整段 AudioBuffer 求值的纯函数**（无流式约束、可任意前看），而不是 AudioWorklet。
 *
 * ⚠️ 为什么 `public/` 下要有一份 **.js**： `AudioWorklet.addModule(url)` 拉取的是
 * **原生 JS**，构建工具不会对它做 TS 转译（`?url` 也只会原样拷贝源文件）。
 * 本文件运行在 **AudioWorklet 全局作用域**中：不得 import 任何模块、
 * 不得引用 `window` / `document`、只能使用 AudioWorkletProcessor 全局 API。
 *
 * ## 参数语义：`rate` = **播放倍速**（与 `compositor.sourceTimeMs` 一致）
 *
 * `sourceTimeMs = inMs + (timeMs - startMs) × clip.speed`
 * → 每 1ms 输出要消耗 `speed` ms 的输入，所以 **`rate = 2` 表示「两倍速」**，
 * 输出时长是输入的一半。
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
 * ## ⚠️ 合成必须**按输出速率配速**（曾经的第五个致命 bug）
 *
 * 旧实现是「**贪心填满输出 FIFO**」：
 * ```js
 * while (state.canSynthesize() && state.pending + S + quantum <= OUT_FIFO) synthesize();
 * ```
 * 后果是每个输出 quantum 产出**整数倍**的帧，而输出每 quantum 只被抽走
 * `quantum` 个样本 ⇒ **素材消耗速率 ≡ 输入到达速率（1×）**
 * ⇒ 内容推进速率恒为 1× ⇒ **`rate` 对输出没有任何影响**。
 *
 * 实证（脉冲信号：3 秒素材，每 0.5 秒一个 20ms 脉冲）：
 * | rate | 脉冲数 | 平均间隔 | 期望间隔 |
 * |---|---|---|---|
 * | 1（旧实现） | 6 | 0.500s | 0.500s |
 * | 1.5（旧实现） | **18** | **0.148s** | 0.333s |
 * | 0.5（旧实现） | 4 | 0.841s | 1.000s |
 *
 * `rate=1.5` 时脉冲从 6 个变成 18 个 —— 那不是「变速」，而是**内容被复制重排**。
 *
 * 现在改成「每个输出 quantum 合成**恰好一帧**」：
 * `pos` 每 quantum 前进 `hop = S × rate` ⇒ 素材推进速率 = `rate` ×，
 * 脉冲间隔 = `0.5 / rate` ✓，脉冲**不被复制** ✓。
 *
 * ## ⚠️ 流式处理器的固有限制：`rate > 1`（加速）做不到
 *
 * `rate > 1` 要求每 1ms 输出消耗 `rate` ms 的**输入** —— 而输入此刻还没到。
 * ⇒ 加速在流式图里**物理上不可能**，本 worklet 把 `rate` 钳到 **1（透明）**
 * 并通过 `port.postMessage` 上报 `{ type: 'rate-clamped', requested, effective }`。
 *
 * `rate ≤ 1`（减速）流式可行（素材到达速率 ≥ 消耗速率，不会欠载），
 * 但受 **HISTORY 缓冲**限制（见文件头第 2 条）。
 *
 * ## 不变式（被 `e2e/worklet.spec.ts` 断言）
 *
 * 1. **`rate === 1` 时输出与输入逐样本相等**（实测 RMS 相对误差 0.00000%，
 *    最大误差 2.98e-8 = float32 机器精度）：相邻帧首尾相接，互补窗之和恒为 1。
 * 2. **`rate < 1` 时脉冲间隔 = `0.5 / rate`**（内容被真正拉伸，不是复制）。
 * 3. **脉冲数不得增加**（内容不被复制重排）。
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
 *
 * ⚠️ **这是流式 WSOLA 的硬约束**：减速（`rate < 1`）时 worklet 消费素材的速度
 * 慢于素材到达速度 ⇒ **「已到达但还没消费」的积压会无界增长**。
 * 读取位置一旦掉出历史缓冲（`pos < head`），就会读到负下标 ⇒ 输出垃圾/静音。
 *
 * 实测（Node 侧逐量子模拟，3 秒素材 + 脉冲信号，rate=0.5）：
 *
 * | HISTORY | 结果 |
 * |---|---|
 * | 4096（85ms） | 1 个脉冲、输出 41ms —— **垃圾**（读取位置掉出缓冲） |
 * | 65536（1.36s） | 3 个脉冲、间隔 0.9987s —— **正确** |
 *
 * ⇒ 缓冲越大，能拉伸的素材越长；超出后内容推进会退化（见 `synthesize()` 的兜底）。
 */
const HISTORY = 65536;

/** 输出 FIFO 长度（样本）。 */
const OUT_FIFO = 4096;

/**
 * 变速倍率允许的数值范围。
 *
 * ⚠️ 上限是 **1**，不是「数值上能取多大」—— 这是**流式处理器的物理上限**：
 * `rate > 1` 需要尚未到达的输入（见文件头「流式处理器的固有限制」）。
 * 加速请交给源自身的 `playbackRate`。
 */
const MIN_RATE = 0.25;
const MAX_RATE = 1;

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

    // ⚠️ 兜底：读取位置不能掉出历史缓冲。
    // 减速时「已到达但未消费」的积压无界增长，一旦 `pos - head` 接近 HISTORY，
    // 就会读到负下标（垃圾输出）。这里按需**加大本帧的推进量**，把读取位置拉回
    // 缓冲内 —— 代价是该帧的内容推进快于 `rate`（拉伸在该帧退化成 1×），
    // 但**绝不产生垃圾**。这是有界流式缓冲下的最优降级。
    const maxPos = this.head + HISTORY - this.frameLength - SEARCH_RADIUS;
    const catchUp = Math.max(0, this.pos - maxPos);
    const hop = this.hop + catchUp;

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
    const tailBase = base + hop;
    for (let i = 0; i < S; i += 1) {
      const sample = history[tailBase + i];
      prevTail[i] = sample * taper.inn[i];
      template[i] = sample;
      energy += sample * sample;
    }
    this.templateEnergy = energy;

    this.pos = position + hop;
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
    const raw = typeof requested === 'number' && requested > 0 ? requested : 1;
    this.rate = clamp(raw, MIN_RATE, MAX_RATE);
    // ⚠️ 流式上限：rate > 1 物理上做不到（需要尚未到达的输入）⇒ 钳到 1 并**上报**，
    // 让调用方知道「加速没生效」，改用源自身的 playbackRate。
    if (Math.abs(raw - this.rate) > 1e-9) {
      this.port.postMessage({ type: 'rate-clamped', requested: raw, effective: this.rate });
    }
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

    // 2) 按**输出速率配速**合成：每个输出 quantum 合成**恰好一帧**。
    //
    // ⚠️ 这里**不能**贪心填 FIFO（旧实现就是这么写的）：贪心会让每个 quantum
    // 产出整数倍的帧 ⇒ 素材消耗速率 ≡ 输入到达速率 ⇒ 内容推进恒为 1×，
    // `rate` 完全不起作用（脉冲信号实测：rate=1.5 时 6 个脉冲变成 18 个）。
    //
    // 配速后：`pos` 每 quantum 前进 `hop = S × rate` ⇒ 素材推进速率 = `rate` ×
    // ⇒ 内容推进速率 = rate ✓，脉冲间隔 = `0.5 / rate` ✓。
    for (let c = 0; c < availableInputs; c += 1) {
      const state = this.channelState(c);
      // FIFO 至少留一帧的余量（避免写越界）
      if (state.pending + S <= OUT_FIFO && state.canSynthesize()) {
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