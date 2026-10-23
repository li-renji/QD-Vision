/**
 * 变速保音高 worklet 的**真实渲染**测试（离线 AudioContext）。
 *
 * ## 为什么必须用 e2e
 *
 * `AudioWorkletProcessor` 只存在于 AudioWorklet 全局作用域，happy-dom 里
 * **无法实例化**；因此本文件的断言只能在真实浏览器里跑。
 *
 * ## 背景：曾经输出静音
 *
 * teammate 实测发现 worklet 在 `OfflineAudioContext` 里渲染出峰值 0.0000 的静音，
 * 当时怀疑是「离线不支持 AudioWorklet」。实测结论相反：
 *
 * | 通路 | 离线渲染峰值 |
 * |---|---|
 * | `source → destination` | 0.5437 |
 * | `source → 直通 worklet → destination` | 0.5437 |
 * | `source → WSOLA worklet → destination` | **0.0000** ← 是 worklet 自身的 bug |
 *
 * 根因是环形缓冲索引 `(writeIndex - RING_SIZE + offset + i) % RING_SIZE`
 * 在 JS 里产生**负数下标**（JS 的 `%` 保留被除数符号），读到的永远是 0。
 * 本文件把「worklet 真的出声」与「rate=1 逐样本透明」钉成硬断言。
 *
 * ## 踩过的两个坑（写在这里避免下次重蹈）
 *
 * 1. **必须先 `await addModule()`** 才能 `new AudioWorkletNode`，否则抛
 *    `InvalidStateError: AudioWorklet does not have a valid AudioWorkletGlobalScope`。
 * 2. 输入波形必须在**页面上下文里**生成。把 Node 侧的 `Float32Array` 当参数传给
 *    `page.evaluate` 再 `copyToChannel`，会因跨 realm 被拒
 *    （`parameter 1 is not of type 'Float32Array'`）。
 */

import { expect, test, type Page } from '@playwright/test';

/** 采样率（与 e2e 内联脚本保持一致）。 */
const SAMPLE_RATE = 48000;

/** worklet 的处理器名（必须与 `PITCH_PRESERVE_WORKLET_NAME` 一致）。 */
const PROCESSOR_NAME = 'clipcut-pitch-preserve-stretch';

/** 渲染统计。 */
interface RenderStats {
  peak: number;
  rms: number;
  nanCount: number;
}

/** 新建工程并进入编辑器（提供已构建好的应用与 worklet 静态文件）。 */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="text"]').first().fill('e2e worklet');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await page.waitForSelector('canvas[aria-label="preview"]', { timeout: 20_000 });
}

test.describe('变速保音高 worklet（真实渲染）', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('worklet 静态文件可加载，处理器能注册（不是 404）', async ({ page }) => {
    const result = await page.evaluate(
      async ({ sampleRate, processorName }) => {
        const response = await fetch('/worklets/pitchPreserveStretchProcessor.js');
        if (!response.ok) return { status: response.status, registered: false };
        const context = new OfflineAudioContext(1, 1024, sampleRate);
        await context.audioWorklet.addModule('/worklets/pitchPreserveStretchProcessor.js');
        const node = new AudioWorkletNode(context, processorName, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        return { status: response.status, registered: Boolean(node) };
      },
      { sampleRate: SAMPLE_RATE, processorName: PROCESSOR_NAME },
    );

    expect(result.status).toBe(200);
    expect(result.registered).toBe(true);
  });

  /**
   * **核心回归**：worklet 必须真的出声（历史上输出恒为 0）。
   *
   * 同时复现 teammate 的对照实验：不挂 worklet / 挂 worklet(rate=1) 都应有声。
   */
  test('WSOLA worklet 离线渲染出非静音波形（对照组也有声）', async ({ page }) => {
    const render = async (useWorklet: boolean, rate: number): Promise<RenderStats> =>
      page.evaluate(
        async ({ sampleRate, processorName, useWorklet: use, rate: r }) => {
          const seconds = 1;
          const length = sampleRate * seconds;
          const context = new OfflineAudioContext(1, length, sampleRate);
          if (use) {
            await context.audioWorklet.addModule('/worklets/pitchPreserveStretchProcessor.js');
          }

          // 输入在页面上下文里生成（跨 realm 的 Float32Array 会被 copyToChannel 拒绝）
          const data = new Float32Array(length);
          for (let i = 0; i < length; i += 1) {
            data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
          }
          const buffer = context.createBuffer(1, length, sampleRate);
          buffer.copyToChannel(data, 0);

          const source = context.createBufferSource();
          source.buffer = buffer;
          let tail: AudioNode = source;
          if (use) {
            const worklet = new AudioWorkletNode(context, processorName, {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [1],
              processorOptions: { rate: r },
            });
            source.connect(worklet);
            tail = worklet;
          }
          tail.connect(context.destination);
          source.start();

          const channel = (await context.startRendering()).getChannelData(0);
          let peak = 0;
          let nanCount = 0;
          let sumSquares = 0;
          // 跳过起始的预热区（worklet 需要攒够一帧才开始输出）
          for (let i = 4096; i < channel.length; i += 1) {
            const value = channel[i];
            if (!Number.isFinite(value)) nanCount += 1;
            peak = Math.max(peak, Math.abs(value));
            sumSquares += value * value;
          }
          return { peak, nanCount, rms: Math.sqrt(sumSquares / (channel.length - 4096)) };
        },
        { sampleRate: SAMPLE_RATE, processorName: PROCESSOR_NAME, useWorklet, rate },
      );

    const direct = await render(false, 1);
    const passthrough = await render(true, 1);
    const slowed = await render(true, 0.5);
    const spedUp = await render(true, 2);

    // 对照组：不挂 worklet / 挂 worklet 但 rate=1
    expect(direct.peak).toBeGreaterThan(0.4);
    expect(passthrough.peak).toBeGreaterThan(0.4);
    // ⚠️ 下面这两条就是历史 bug 的回归防护：曾经都是 0.0000
    expect(slowed.peak).toBeGreaterThan(0.2);
    expect(spedUp.peak).toBeGreaterThan(0.2);
    // 任何倍率下都不该出现 NaN
    expect(slowed.nanCount).toBe(0);
    expect(spedUp.nanCount).toBe(0);
  });

  /**
   * **`rate === 1` 的不变式：逐样本透明**。
   *
   * 互补 Hann 窗 + 连续帧 ⇒ 交叉淡化后应精确还原输入。
   * 窗函数配错、重叠区算错、索引错位、`rate` 方向反了 —— 都会让这条变红。
   * 历史实现的 RMS 误差是 0.5（完全不透明），现在是 float32 精度量级。
   */
  test('rate=1 时逐样本透明（RMS 误差 < 1e-4）', async ({ page }) => {
    const result = await page.evaluate(
      async ({ sampleRate, processorName }) => {
        const seconds = 1;
        const length = sampleRate * seconds;
        const context = new OfflineAudioContext(1, length, sampleRate);
        await context.audioWorklet.addModule('/worklets/pitchPreserveStretchProcessor.js');

        const input = new Float32Array(length);
        for (let i = 0; i < length; i += 1) {
          input[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
        }
        const buffer = context.createBuffer(1, length, sampleRate);
        buffer.copyToChannel(input, 0);

        const source = context.createBufferSource();
        source.buffer = buffer;
        const worklet = new AudioWorkletNode(context, processorName, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: { rate: 1 },
        });
        source.connect(worklet);
        worklet.connect(context.destination);
        source.start();

        const output = (await context.startRendering()).getChannelData(0);

        // 找最佳对齐（worklet 有固定的预热延迟），再逐样本比较
        const window = 8192;
        let bestLag = 0;
        let bestError = Infinity;
        for (let lag = 0; lag + window <= output.length; lag += 1) {
          let sumSquares = 0;
          for (let i = 0; i < window; i += 1) {
            const delta = output[lag + i] - input[i];
            sumSquares += delta * delta;
          }
          if (sumSquares < bestError) {
            bestError = sumSquares;
            bestLag = lag;
          }
        }
        return { lag: bestLag, rmsError: Math.sqrt(bestError / window) };
      },
      { sampleRate: SAMPLE_RATE, processorName: PROCESSOR_NAME },
    );

    // 预热延迟必须落在合理区间：> 0 说明攒帧生效（为 0 反而说明没在工作），< 4096 说明很短
    expect(result.lag).toBeGreaterThan(0);
    expect(result.lag).toBeLessThan(4096);
    // 0.5 幅度正弦 → 误差 < 1e-4 即 float32 精度量级
    expect(result.rmsError).toBeLessThan(1e-4);
  });

  /** 静音输入不应产生 NaN / 爆音（历史实现的环形缓冲越界会产生垃圾值）。 */
  test('静音输入不产生 NaN 或非零输出', async ({ page }) => {
    const result = await page.evaluate(
      async ({ sampleRate, processorName }) => {
        const length = sampleRate;
        const context = new OfflineAudioContext(1, length, sampleRate);
        await context.audioWorklet.addModule('/worklets/pitchPreserveStretchProcessor.js');

        // 全 0 的 buffer
        const buffer = context.createBuffer(1, length, sampleRate);
        const source = context.createBufferSource();
        source.buffer = buffer;
        const worklet = new AudioWorkletNode(context, processorName, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: { rate: 2 },
        });
        source.connect(worklet);
        worklet.connect(context.destination);
        source.start();

        const channel = (await context.startRendering()).getChannelData(0);
        let peak = 0;
        let nanCount = 0;
        for (let i = 0; i < channel.length; i += 1) {
          const value = channel[i];
          if (!Number.isFinite(value)) nanCount += 1;
          peak = Math.max(peak, Math.abs(value));
        }
        return { peak, nanCount };
      },
      { sampleRate: SAMPLE_RATE, processorName: PROCESSOR_NAME },
    );

    expect(result.nanCount).toBe(0);
    expect(result.peak).toBeLessThan(1e-6);
  });
});