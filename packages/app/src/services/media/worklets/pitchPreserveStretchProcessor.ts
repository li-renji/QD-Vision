/**
 * WSOLA 变速保音高 AudioWorklet（FR-020③）。
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

declare function registerProcessor(name: string, ctor: unknown): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

/** 处理参数。 */
interface StretchOptions {
  /** 变速倍率（>1 变快，<1 变慢）。 */
  rate?: number;
}

/** WSOLA 处理器。 */
class PitchPreserveStretchProcessor extends AudioWorkletProcessor {
  /** 变速倍率。 */
  private rate = 1;

  /** 帧长（样本）。 */
  private readonly frameSize = 1024;

  /** 搜索窗半径（样本）。 */
  private readonly searchRadius = 512;

  /** 内部环形缓冲。 */
  private readonly ring: Float32Array;

  /** 环形缓冲写指针。 */
  private writeIndex = 0;

  /** 已填充的样本数。 */
  private filled = 0;

  /** 上一个输出帧（用于重叠相加）。 */
  private previousTail: Float32Array | null = null;

  /** 上一个输出帧的 Hann 窗尾部。 */
  private previousWindow: Float32Array | null = null;

  /** 上一帧的原波形（用于相似度搜索）。 */
  private lastFrame: Float32Array | null = null;

  constructor(options?: { processorOptions?: StretchOptions }) {
    super();
    this.rate = options?.processorOptions?.rate ?? 1;
    this.ring = new Float32Array(this.frameSize * 8);

    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { rate?: number } | undefined;
      if (data && typeof data.rate === 'number' && data.rate > 0) {
        this.rate = data.rate;
      }
    };
  }

  /** 读取环形缓冲中的一段。 */
  private read(offset: number, length: number): Float32Array {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const index = (this.writeIndex - this.ring.length + offset + i) % this.ring.length;
      out[i] = this.ring[index] ?? 0;
    }
    return out;
  }

  /** 写入环形缓冲。 */
  private write(chunk: Float32Array): void {
    for (let i = 0; i < chunk.length; i += 1) {
      this.ring[this.writeIndex] = chunk[i] ?? 0;
      this.writeIndex = (this.writeIndex + 1) % this.ring.length;
    }
    this.filled = Math.min(this.filled + chunk.length, this.ring.length);
  }

  /** Hann 窗。 */
  private hann(length: number): Float32Array {
    const window = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
    }
    return window;
  }

  /**
   * 在搜索窗内寻找与 `reference` 最相似的片段（归一化互相关）。
   */
  private findBestOffset(reference: Float32Array, available: number): number {
    const limit = Math.min(this.searchRadius, Math.max(0, available - this.frameSize));
    if (limit <= 0) return 0;

    let bestOffset = 0;
    let bestScore = -Infinity;

    for (let offset = 0; offset <= limit; offset += 1) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < this.frameSize; i += 1) {
        const a = reference[i] ?? 0;
        const b = this.read(offset + i, 1)[0] ?? 0;
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

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || input.length === 0 || output.length === 0) return true;

    const inputChannel = input[0];
    const outputChannel = output[0];
    if (!inputChannel || !outputChannel) return true;

    this.write(inputChannel);

    const analysisStep = Math.max(1, Math.round(this.frameSize / 2 / this.rate));
    const synthesisStep = Math.round(this.frameSize / 2);

    const window = this.hann(this.frameSize);

    // 可用样本不足时先累积
    if (this.filled < this.frameSize) {
      outputChannel.fill(0);
      return true;
    }

    const candidate = this.read(0, this.frameSize);
    const reference = this.lastFrame ?? candidate;

    // 寻找最相似片段
    const offset = this.findBestOffset(reference, this.filled);
    const frame = this.read(offset, this.frameSize);

    // 交叉淡化：上一帧尾部 + 本帧头部
    const blended = new Float32Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i += 1) {
      const current = (frame[i] ?? 0) * (window[i] ?? 0);
      const previous =
        this.previousTail && this.previousWindow
          ? (this.previousTail[i] ?? 0) * (this.previousWindow[i] ?? 0)
          : 0;
      blended[i] = current + previous;
    }

    // 输出前 synthesisStep 个样本
    const outCount = Math.min(outputChannel.length, synthesisStep);
    for (let i = 0; i < outCount; i += 1) {
      outputChannel[i] = blended[i] ?? 0;
    }
    for (let i = outCount; i < outputChannel.length; i += 1) {
      outputChannel[i] = 0;
    }

    // 保存尾部用于下一次重叠
    this.previousTail = blended.slice(synthesisStep, this.frameSize);
    this.previousWindow = window.slice(synthesisStep, this.frameSize);
    this.lastFrame = frame.slice(0, this.frameSize);

    // 消费 analysisStep 个样本
    const consumed = this.read(0, analysisStep);
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
    void consumed;

    return true;
  }
}

registerProcessor('clipcut-pitch-preserve-stretch', PitchPreserveStretchProcessor);
