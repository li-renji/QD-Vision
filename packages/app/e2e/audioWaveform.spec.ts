/**
 * 预览音频「真的有声音」的波形级验收（用户反馈「没有声音」的核心证据）。
 *
 * ## 与 `audio.spec.ts` 的分工
 *
 * `audio.spec.ts` 断言的是**接线状态**（context 是否 running、元素是否解除静音、
 * 图里有没有 clip）；本文件断言的是**真实音频信号** —— 用 `AnalyserNode` 从
 * 主混音总线上取时域波形，直接回答「扬声器里到底有没有东西」。
 *
 * headless Chromium 没有音频输出设备，因此不可能真的「听见」；
 * 但只要 `masterGain → destination` 这条链路上有样本流动，
 * AnalyserNode 就能观测到。**波形峰值恒为 0（全零 = 零电平）= 静音。**
 *
 * ## 测试素材
 *
 * 页面内用 `OscillatorNode → MediaStreamDestination` 录一段 **VP8 + Opus** 的
 * WebM，正弦波音量按 `0.3 + 0.4·|sin|` 起伏 —— 于是「音量随时间起伏」本身
 * 就成了一个可断言的抓手（验收点 5）。
 *
 * ## 验收点 7 / 8 走**真实 UI**
 *
 * 增益与淡入都通过检查器面板（`AudioSection`）的 `NumberField` 修改，
 * 不走任何测试专用后门 —— 这样顺带验证了「检查器改参数 → 混音图重建 →
 * 波形变化」这条完整链路。
 */

import { expect, test, type Page } from '@playwright/test';

/** 预览音频诊断快照（与 `PreviewAudioDiagnostics` 对应）。 */
interface AudioDiagnostics {
  contextState: string | null;
  masterGain: number;
  trackBusCount: number;
  clipCount: number;
  routedElementCount: number;
  unmutedElementCount: number;
  workletAvailable: boolean;
}

/** 读取页面里暴露的预览音频诊断快照。 */
async function readDiagnostics(page: Page): Promise<AudioDiagnostics | null> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __clipcutPreviewAudio?: () => AudioDiagnostics;
    };
    return scope.__clipcutPreviewAudio ? scope.__clipcutPreviewAudio() : null;
  });
}

/**
 * 在主混音总线上挂一个 `AnalyserNode`。
 *
 * ⚠️ 必须挂在**同一个 AudioContext** 上 —— 所以经由 `AudioNode.context`
 * 拿上下文，而不是自己 `new AudioContext()`（那会得到一个不相干的上下文，
 * 读出来恒为静默）。
 *
 * 挂在总线上是**纯观测**，不改变任何增益 —— AnalyserNode 自己不输出。
 */
async function attachAnalyser(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __clipcutPreviewAudioMaster?: () => GainNode | null;
      __clipcutAnalyser?: AnalyserNode;
    };
    const master = scope.__clipcutPreviewAudioMaster?.();
    if (!master) throw new Error('主混音总线尚未建立');
    const analyser = master.context.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    scope.__clipcutAnalyser = analyser;
  });
}

/** 采样一次时域波形，返回峰值（0 = 完全静音，非 0 = 有波形）。 */
async function samplePeak(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __clipcutAnalyser?: AnalyserNode };
    const analyser = scope.__clipcutAnalyser;
    if (!analyser) throw new Error('AnalyserNode 未挂上');
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const value of data) {
      peak = Math.max(peak, Math.abs(value - 128));
    }
    return peak;
  });
}

/**
 * 连续采样若干次，返回峰值**最大值**（抗单点抖动）。
 *
 * ⚠️ 采样窗口必须覆盖素材的整个音量包络周期（≈ 2s，见 `importClipWithAudio`
 * 里的 `0.3 + 0.4·|sin(frame/30·π)|`），否则「增益变小」会被包络起伏掩盖，
 * 产生**假通过**。`samples × intervalMs` 应 ≥ 2500ms。
 */
async function samplePeakOverTime(page: Page, samples: number, intervalMs: number): Promise<number> {
  let max = 0;
  for (let i = 0; i < samples; i += 1) {
    max = Math.max(max, await samplePeak(page));
    await page.waitForTimeout(intervalMs);
  }
  return max;
}

/** 覆盖整个包络周期（约 2.6s）采样一次峰值最大值。 */
async function samplePeakOverFullEnvelope(page: Page): Promise<number> {
  return samplePeakOverTime(page, 13, 200);
}

/**
 * 在检查器里设置淡入时长（毫秒）。
 *
 * `NumberField` 的 input 上**没有** aria-label —— 标签是 `<label>` 里的一个
 * `<span>`，所以只能按 label 文本定位再取内部 input。
 */
async function setInspectorFadeIn(page: Page, value: number): Promise<void> {
  const field = page
    .locator('label')
    .filter({ hasText: /淡入|Fade in/ })
    .locator('input[type="number"]')
    .first();
  await field.waitFor({ state: 'visible', timeout: 15_000 });
  await field.fill(String(value));
  // 受控输入：失焦才触发 onValueChange（NumberField 在 onBlur 里 commit）
  await field.blur();
  await page.waitForTimeout(500);
}

/**
 * 把片段音量调到 0。
 *
 * `inspector.gain` 是 Radix `Slider`（有 `aria-label`，`role="slider"`），
 * 按 `Home` 键直接跳到最小值 0 —— 比模拟拖拽稳，也不依赖像素坐标。
 */
async function setInspectorGainToZero(page: Page): Promise<void> {
  // ⚠️ `aria-label` 挂在 Radix Slider 的 **Root** 上，真正响应键盘的是内部 Thumb
  const thumb = page
    .locator('[aria-label="音量"] [role="slider"], [aria-label="Volume"] [role="slider"]')
    .first();
  await thumb.waitFor({ state: 'visible', timeout: 15_000 });
  await thumb.focus();
  // Home 跳到最小值（Radix Slider 的标准键盘行为，比模拟拖拽稳）
  await page.keyboard.press('Home');
  await expect(thumb).toHaveAttribute('aria-valuenow', '0');
  await page.waitForTimeout(500);
}

/** 录一段带正弦波音频的 WebM 并导入。 */
async function importClipWithAudio(page: Page, fileName = 'wave-clip.webm'): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');

    const audioCtx = new AudioContext();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const sink = audioCtx.createMediaStreamDestination();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    gain.gain.value = 0.3;
    oscillator.connect(gain);
    gain.connect(sink);
    oscillator.start();

    const stream = canvas.captureStream(30);
    for (const track of sink.stream.getAudioTracks()) stream.addTrack(track);

    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start();

    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const draw = (): void => {
        const elapsed = performance.now() - startedAt;
        ctx.fillStyle = `hsl(${(elapsed / 16) % 360} 90% 55%)`;
        ctx.fillRect(0, 0, 320, 240);
        // ⚠️ 音量包络是「幅度会起伏」这条断言的前提：恒定增益的素材本来就不会起伏
        const frame = Math.floor(elapsed / 33);
        gain.gain.value = 0.3 + 0.4 * Math.abs(Math.sin((frame / 30) * Math.PI));
        if (elapsed < 9000) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    oscillator.stop();
    await audioCtx.close();

    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'wave-clip.webm', {
      type: 'video/webm',
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });

  await expect
    .poll(async () => page.locator(`text=${fileName}`).count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/** 新建工程并进入编辑器。 */
async function openFreshProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="text"]').first().fill('e2e 波形验证');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await page.waitForSelector('canvas[aria-label="preview"]', { timeout: 20_000 });
}

/** 把素材加入时间线。 */
async function addToTimeline(page: Page, fileName: string): Promise<void> {
  await page.locator(`text=${fileName}`).first().dblclick();
  await page.waitForTimeout(1200);
}

/** 点播放。 */
async function pressPlay(page: Page): Promise<void> {
  await page.locator('button[aria-label*="播放"], button[aria-label*="Play"]').first().click();
}

/** 等待 context 进入 running（自动播放策略已放行）。 */
async function waitForRunning(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readDiagnostics(page))?.contextState ?? null, { timeout: 10_000 })
    .toBe('running');
}

/** 等待混音图里至少有一个 clip。 */
async function waitForClipInGraph(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readDiagnostics(page))?.clipCount ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);
}

test.describe('预览音频波形级验收（真的有声音）', () => {
  /**
   * 验收点 1 / 2 / 3 / 4 / 5：
   * 播放时 context running、元素解除静音、主总线增益非零、
   * **波形非静音**、**音量随时间起伏**。
   */
  test('播放时主总线输出非静音波形，且音量随时间起伏', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'wave-clip.webm');

    // 验收点 1
    await pressPlay(page);
    await waitForRunning(page);

    // 验收点 2 + 3
    const diagnostics = await readDiagnostics(page);
    expect(diagnostics?.unmutedElementCount ?? 0).toBeGreaterThan(0);
    expect(diagnostics?.masterGain ?? 0).toBeGreaterThan(0);

    await attachAnalyser(page);

    // 验收点 4 + 5：连续采样，验证「有波形」且「幅度在变」
    const peaks: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      peaks.push(await samplePeak(page));
      await page.waitForTimeout(200);
    }
    const maxPeak = Math.max(...peaks);
    const nonSilentSamples = peaks.filter((peak) => peak > 4).length;

    // 有真实波形
    expect(nonSilentSamples).toBeGreaterThanOrEqual(7);
    expect(maxPeak).toBeGreaterThan(8);
    // 幅度确实在起伏（恒 0 = 没接上；恒定不变 = 没走包络 / 是直流）
    expect(new Set(peaks).size).toBeGreaterThan(2);
  });


  /**
   * PRD FR-020③：**音频变速保持音高**（`preservesPitch` + `playbackRate`）。
   *
   * 这是 `<video>` 元素自带的能力，**不是** WSOLA worklet —— teammate 已实测
   * 结论：WSOLA 是「时间伸缩」而非「音高还原」，且流式 worklet 做不了有界缓冲
   * 的完整时间伸缩。所以预览侧的保音高必须走 `preservesPitch`。
   *
   * 断言点：
   * 1. 元素 `preservesPitch === true`（根因修复点）；
   * 2. 元素的 `playbackRate === clip.speed`（片段倍速真的推到了元素上）。
   */
  test('变速 clip：元素 preservesPitch=true 且 playbackRate 等于 clip.speed', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'wave-clip.webm');

    // 选中 clip 并把 speed 改成 2（检查器里「倍速」字段）
    await page.locator('canvas[aria-label="preview"]').click();
    await page.waitForTimeout(600);
    const speedField = page
      .locator('label')
      .filter({ hasText: /自定义倍速|Custom speed/ })
      .locator('input[type="number"]')
      .first();
    await speedField.waitFor({ state: 'visible', timeout: 15_000 });
    await speedField.fill('2');
    await speedField.blur();
    await page.waitForTimeout(600);

    await pressPlay(page);
    await waitForRunning(page);
    await waitForClipInGraph(page);

    // 元素是游离的（document.createElement，不在 DOM 里）→ 经诊断通道取
    const state = await page.evaluate(() => {
      const scope = globalThis as typeof globalThis & {
        __clipcutElementStates?: () => Array<{
          assetId: string;
          preservesPitch: boolean;
          playbackRate: number;
          muted: boolean;
        }>;
      };
      return scope.__clipcutElementStates ? scope.__clipcutElementStates() : null;
    });

    expect(state).not.toBeNull();
    expect(state?.length ?? 0).toBeGreaterThan(0);
    for (const element of state ?? []) {
      // 保音高必须开着（PRD FR-020③）
      expect(element.preservesPitch).toBe(true);
      // 片段倍速 2 已推到元素上
      expect(element.playbackRate).toBeCloseTo(2, 3);
    }
  });

  /** 验收点 6：静音轨道真的没声音。 */
  test('静音轨道后该轨道退出混音图、波形归零', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'wave-clip.webm');

    // 先确认「有声」时确实在响（否则后面的静音断言毫无意义）
    await pressPlay(page);
    await waitForRunning(page);
    await waitForClipInGraph(page);
    await attachAnalyser(page);
    expect(await samplePeakOverFullEnvelope(page)).toBeGreaterThan(20);

    // 点轨道头的静音按钮
    await page.locator('button[aria-label*="静音"], button[aria-label*="Mute"]').first().click();
    await page.waitForTimeout(600);

    const muted = await readDiagnostics(page);
    expect(muted?.clipCount ?? 0).toBe(0);
    expect(muted?.unmutedElementCount ?? 0).toBe(0);

    // 图里没东西了 → 主总线上不应再有波形
    await page.waitForTimeout(700);
    expect(await samplePeakOverFullEnvelope(page)).toBeLessThanOrEqual(4);
  });

  /** 验收点 7：`clip.audio.gain` 生效 —— 通过检查器把音量调到 0，波形必须消失。 */
  test('检查器调低 clip.audio.gain → 波形幅度下降', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'wave-clip.webm');

    // 选中时间线上的 clip，让检查器显示它的音频参数
    await page.locator('canvas[aria-label="preview"]').click();
    await page.waitForTimeout(600);

    await pressPlay(page);
    await waitForRunning(page);
    await waitForClipInGraph(page);
    await attachAnalyser(page);

    const loudPeak = await samplePeakOverFullEnvelope(page);
    expect(loudPeak).toBeGreaterThan(20);

    // 通过真实 UI 把增益降到 0
    await setInspectorGainToZero(page);
    await page.waitForTimeout(600);

    // ⚠️ 采样窗口覆盖整个包络周期 —— 否则包络起伏会让断言假通过
    const quietPeak = await samplePeakOverFullEnvelope(page);
    expect(quietPeak).toBeLessThan(loudPeak / 4);
  });

  /** 验收点 8：淡入的 clip，起始段波形弱于中段。 */
  test('带淡入的 clip：起始段波形弱于中段', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'wave-clip.webm');

    // 选中 clip 并通过检查器设置 1500ms 淡入
    await page.locator('canvas[aria-label="preview"]').click();
    await page.waitForTimeout(600);
    await setInspectorFadeIn(page, 1500);

    // 加入 clip 后播放头本来就在 0，直接从头播放
    await pressPlay(page);
    await waitForRunning(page);
    await waitForClipInGraph(page);
    await attachAnalyser(page);

    // 起步段（淡入进行中）
    const earlyPeak = await samplePeakOverTime(page, 3, 100);
    // 中段（淡入已完成）
    await page.waitForTimeout(1500);
    const midPeak = await samplePeakOverTime(page, 6, 100);

    expect(midPeak).toBeGreaterThan(earlyPeak);
  });
});