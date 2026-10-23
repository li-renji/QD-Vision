/**
 * WSOLA 变速保音高 AudioWorklet（运行时版本，FR-020③）。
 *
 * ⚠️ 为什么 `public/` 下要有一份 **.js** 副本，而不是直接用
 * `src/services/media/worklets/pitchPreserveStretchProcessor.ts`：
 *
 * `AudioWorklet.addModule(url)` 拉取的是**原生 JS**，Vite 不会对它做 TS 转译
 * （`?url` 后缀也只会原样拷贝源文件）。因此运行时必须有一份纯 JS。
 * 两者由 `src/services/media/__tests__/workletAsset.test.ts` 做一致性守门：
 * 处理器名必须与 `PITCH_PRESERVE_WORKLET_NAME` 相同。
 *
 * ⚠️ 本文件运行在 **AudioWorklet 全局作用域**中：
 *  - 不得 import 任何模块；
 *  - 不得引用 `window` / `document`；
 *  - 只能使用 AudioWorkletProcessor 全局 API。
 *
 * 算法（经典 WSOLA / Waveform-Similarity Overlap-Add）：
 *  1. 以固定帧长 `frameSize` 读取输入；
 *  2. 在搜索窗内寻找与「理想重叠段」最相似的片段（归一化互相关）；
 *  3. 用 Hann 窗做交叉淡化拼接；
 *  4. 输出速率与输入速率解耦，从而实现变速不变调。
 */

/** 处理参数。 */
const DEFAULT_RATE = 1;

/** 帧长（样本）。 */
const FRAME_SIZE = 1024;

/** 搜索窗半径（样本）。 */
const SEARCH_RADIUS = 512;

/** 环形缓冲长度（样本）—— 需远大于帧长 + 搜索窗。 */
const RING_SIZE = FRAME_SIZE * 8;

class PitchPreserveStretchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {number} */
    this.rate = DEFAULT_RATE;
    /** @type {Float32Array} */
    this.ring = new Float32Array(RING_SIZE);
    /** @type {number} */
    this.writeIndex = 0;
    /** @type {number} */
    this.filled = 0;
    /** @type {Float32Array | null} */
    this.previousTail = null;
    /** @type {Float32Array | null} */
    this.previousTailWindow = null;
    /** @type {Float32Array | null} */
    this.lastFrame = null;
    /** @type {Float32Array} */
    this.hann = hannWindow(FRAME_SIZE);

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && typeof data.rate === 'number' && data.rate > 0) {
        this.rate = data.rate;
      }
    };
  }

  /** 读取环形缓冲中的一段。 */
  read(offset, length) {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = this.ring[(this.writeIndex - RING_SIZE + offset + i) % RING_SIZE] ?? 0;
    }
    return out;
  }

  /** 写入环形缓冲。 */
  write(chunk) {
    for (let i = 0; i < chunk.length; i += 1) {
      this.ring[this.writeIndex] = chunk[i] ?? 0;
      this.writeIndex = (this.writeIndex + 1) % RING_SIZE;
    }
    this.filled = Math.min(this.filled + chunk.length, RING_SIZE);
  }

  /** 在搜索窗内寻找与 reference 最相似的片段（归一化互相关）。 */
  findBestOffset(reference, available) {
    const limit = Math.min(SEARCH_RADIUS, Math.max(0, available - FRAME_SIZE));
    if (limit <= 0) return 0;

    let bestOffset = 0;
    let bestScore = -Infinity;

    for (let offset = 0; offset <= limit; offset += 1) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < FRAME_SIZE; i += 1) {
        const a = reference[i] ?? 0;
        const b = this.ring[(this.writeIndex - RING_SIZE + offset + i) % RING_SIZE] ?? 0;
        dot += a * b;
        normA += a * a;
        normB += b * b;
      }
      const denominator = Math.sqrt(normA * normB);
      const score = denominator > 0 ? dot / denominator : 0;
      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }

    return bestOffset;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || input.length === 0 || output.length === 0) return true;

    const inputChannel = input[0];
    const outputChannel = output[0];
    if (!inputChannel || !outputChannel) return true;

    this.write(inputChannel);

    // 可用样本不足时先累积（输出静音）
    if (this.filled < FRAME_SIZE) {
      outputChannel.fill(0);
      return true;
    }

    const analysisStep = Math.max(1, Math.round(FRAME_SIZE / 2 / this.rate));
    const synthesisStep = Math.round(FRAME_SIZE / 2);
    const hann = this.hann;

    const reference = this.lastFrame ?? this.read(0, FRAME_SIZE);
    const offset = this.findBestOffset(reference, this.filled);
    const frame = this.read(offset, FRAME_SIZE);

    // 交叉淡化：上一帧尾部 + 本帧头部
    const blended = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i += 1) {
      const current = (frame[i] ?? 0) * (hann[i] ?? 0);
      const previous =
        this.previousTail && this.previousTailWindow
          ? (this.previousTail[i] ?? 0) * (this.previousTailWindow[i] ?? 0)
          : 0;
      blended[i] = current + previous;
    }

    const outCount = Math.min(outputChannel.length, synthesisStep);
    for (let i = 0; i < outCount; i += 1) {
      outputChannel[i] = blended[i] ?? 0;
    }
    for (let i = outCount; i < outputChannel.length; i += 1) {
      outputChannel[i] = 0;
    }

    this.previousTail = blended.slice(synthesisStep, FRAME_SIZE);
    this.previousTailWindow = hann.slice(synthesisStep, FRAME_SIZE);
    this.lastFrame = frame.slice(0, FRAME_SIZE);

    // 消费 analysisStep 个样本
    const remaining = this.filled - analysisStep;
    if (remaining > 0) {
      const tail = this.read(analysisStep, remaining);
      this.ring.fill(0);
      this.writeIndex = 0;
      this.filled = 0;
      this.write(tail);
    } else {
      this.ring.fill(0);
      this.writeIndex = 0;
      this.filled = 0;
    }

    return true;
  }
}

/** Hann 窗（交叉淡化用）。 */
function hannWindow(length) {
  const hann = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return hann;
}

registerProcessor('clipcut-pitch-preserve-stretch', PitchPreserveStretchProcessor);