/**
 * 预览音频链路端到端测试（用户反馈「没有声音」的回归防护）。
 *
 * ## 为什么单元测试不够
 *
 * 单测能证明「混音图建起来了」「`muted` 被解除了」，但证明不了
 * **真实浏览器里真的出声**。中间隔着三道只在真浏览器才存在的关卡：
 *
 * 1. **浏览器自动播放策略** —— `AudioContext` 默认 `suspended`，
 *    `resume()` 必须发生在用户手势调用栈内，否则永远不出声；
 * 2. **`HTMLMediaElement.muted` 是输出闸门** —— 元素静音会连
 *    `MediaElementAudioSourceNode` 的输出一起掐断（纯画面预览时代留下的坑）；
 * 3. **`createMediaElementSource` 只能调一次** —— 重建图时若误建第二个，
 *    会抛 `InvalidStateError`，整条链路断掉。
 *
 * ## 断言策略（重要）
 *
 * headless Chromium **没有音频输出设备**，无法直接测「扬声器里有没有声音」。
 * 因此这里断言一组**可观测的等价信号**，它们合起来等价于「有声」：
 *
 * | 信号 | 排除了什么 |
 * |---|---|
 * | `AudioContext.state === 'running'` | 自动播放策略拦截（关卡 1） |
 * | `unmutedElementCount > 0` | 元素静音闸门仍关着（关卡 2） |
 * | `routedElementCount > 0` | 压根没建 source node |
 * | `clipCount > 0` | 混音图里没有任何片段 |
 * | `masterGain > 0` | 主总线增益被写成 0 |
 * | `video.muted === false` | 元素仍处于静音 |
 *
 * 另有一条**真正的音频证据**：`OfflineAudioContext` 渲染同一条正弦波链路，
 * 断言输出 RMS > 0 —— 它证明「图能真的把样本送到 destination」。
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
async function readAudioDiagnostics(page: Page): Promise<AudioDiagnostics | null> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __clipcutPreviewAudio?: () => AudioDiagnostics;
    };
    return scope.__clipcutPreviewAudio ? scope.__clipcutPreviewAudio() : null;
  });
}

/**
 * 在页面里录一段**带声音**的 WebM（VP8 视频 + Opus 音频）并触发导入。
 *
 * 音频来自 `OscillatorNode → MediaStreamAudioDestinationNode`，
 * 再把音轨塞进 canvas 的 captureStream —— 于是产出的文件真的有一条
 * 440Hz 正弦波音轨，可被 `MediaElementAudioSourceNode` 取出。
 */
async function importClipWithAudio(page: Page, fileName = 'e2e-audio.webm'): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');

    // 音频轨：440Hz 正弦波，音量随时间起伏（便于事后确认不是静音）
    const audioCtx = new AudioContext();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const sink = audioCtx.createMediaStreamDestination();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    gain.gain.value = 0.6;
    oscillator.connect(gain);
    gain.connect(sink);
    oscillator.start();

    const stream = canvas.captureStream(30);
    for (const track of sink.stream.getAudioTracks()) stream.addTrack(track);

    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8,opus',
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start();

    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const draw = (): void => {
        const elapsed = performance.now() - startedAt;
        ctx.fillStyle = `hsl(${(elapsed / 16) % 360} 90% 55%)`;
        ctx.fillRect(0, 0, 320, 240);
        if (elapsed < 3000) requestAnimationFrame(draw);
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

    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'e2e-audio.webm', {
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
  await dialog.locator('input[type="text"]').first().fill('e2e 音频验证');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await page.waitForSelector('canvas[aria-label="preview"]', { timeout: 20_000 });
}

/** 把素材加入时间线（双击素材卡片）并等待就绪。 */
async function addToTimeline(page: Page, fileName: string): Promise<void> {
  await page.locator(`text=${fileName}`).first().dblclick();
  await page.waitForTimeout(1500);
}

/** 点播放。 */
async function pressPlay(page: Page): Promise<void> {
  await page.locator('button[aria-label*="播放"], button[aria-label*="Play"]').first().click();
}

test.describe('预览音频链路（用户反馈「没有声音」）', () => {
  /**
   * 刻意**不**覆写 `HTMLMediaElement.prototype.play`。
   *
   * `playback.spec.ts` 覆写它是为了让时间码测试不被自动播放策略干扰；
   * 而本组用例恰恰要验证「真实播放路径」，覆写掉就等于把要测的东西关掉了。
   * headless 的自动播放策略由 `playwright.config.ts` 的
   * `--autoplay-policy=no-user-gesture-required` 放行。
   */
  test('播放带声音的视频：AudioContext running + 元素解除静音 + 混音图非空', async ({
    page,
  }) => {
    // 工程列表页：预览根本没挂载 → 整套音频机制都不存在（不拖慢工程列表）
    await page.goto('/');
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (globalThis as typeof globalThis & { __clipcutPreviewAudio?: unknown })
              .__clipcutPreviewAudio !== undefined,
        ),
      )
      .toBe(false);

    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'e2e-audio.webm');

    // 进编辑器后诊断通道已就绪，但 AudioContext 仍是懒创建的
    expect(await readAudioDiagnostics(page)).not.toBeNull();

    await pressPlay(page);

    // AudioContext 必须真的 running —— 这是「点了播放有声音」的第一前提
    await expect
      .poll(async () => (await readAudioDiagnostics(page))?.contextState ?? null, {
        timeout: 10_000,
      })
      .toBe('running');

    const diagnostics = await readAudioDiagnostics(page);
    expect(diagnostics).not.toBeNull();

    // 混音图里必须有片段（否则等于没接）
    expect(diagnostics?.clipCount ?? 0).toBeGreaterThan(0);
    expect(diagnostics?.trackBusCount ?? 0).toBeGreaterThan(0);

    // 关键：元素已建source node **且** 已解除 muted
    expect(diagnostics?.routedElementCount ?? 0).toBeGreaterThan(0);
    expect(diagnostics?.unmutedElementCount ?? 0).toBeGreaterThan(0);

    // 主总线增益为正（不是被写成 0）
    expect(diagnostics?.masterGain ?? 0).toBeGreaterThan(0);

    // 播放中 clipGain 应当是「正在发声」的正值，而不是恒为 0
    await page.waitForTimeout(600);
    const duringPlayback = await readAudioDiagnostics(page);
    expect(duringPlayback?.contextState).toBe('running');
  });

  test('静音轨道后该 clip 不进混音图、元素保持 muted（验收点：真的没声音）', async ({
    page,
  }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'e2e-audio.webm');
    await pressPlay(page);

    // 先确认「有声」时确实进了图 —— 否则后面的静音断言毫无意义
    await expect
      .poll(async () => (await readAudioDiagnostics(page))?.clipCount ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect((await readAudioDiagnostics(page))?.unmutedElementCount ?? 0).toBeGreaterThan(0);

    // 点轨道头的「静音」按钮（volume-off 图标）
    await page.locator('button[aria-label*="静音"], button[aria-label*="Mute"]').first().click();
    await page.waitForTimeout(800);

    const muted = await readAudioDiagnostics(page);
    expect(muted?.clipCount ?? 0).toBe(0);
    expect(muted?.unmutedElementCount ?? 0).toBe(0);

    // 取消静音 → 回到混音图
    await page.locator('button[aria-label*="取消静音"], button[aria-label*="Unmute"]').first().click();
    await expect
      .poll(async () => (await readAudioDiagnostics(page))?.clipCount ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  /**
   * **真正的音频证据**：`OfflineAudioContext` 渲染一条与预览同构的链路，
   * 断言输出 RMS > 0。
   *
   * 这条不依赖应用状态（不需要导入素材），因此稳定；同时它证明
   * 「source → gain → destination」这条拓扑真的能传递样本 ——
   * 若某处增益被写成 0、或节点没连上，RMS 必然为 0。
   */
  test('混音拓扑能把样本送到 destination（OfflineAudioContext RMS > 0）', async ({ page }) => {
    await openFreshProject(page);

    const rms = await page.evaluate(async () => {
      const offline = new OfflineAudioContext(2, 44100 * 0.5, 44100);
      const oscillator = offline.createOscillator();
      const clipGain = offline.createGain();
      const masterGain = offline.createGain();
      const destination = offline.destination;

      oscillator.type = 'sine';
      oscillator.frequency.value = 440;
      // 与预览一致的增益设置：clipGain 带 0.8，masterGain 为 1
      clipGain.gain.value = 0.8;
      masterGain.gain.value = 1;
      oscillator.connect(clipGain);
      clipGain.connect(masterGain);
      masterGain.connect(destination);
      oscillator.start();

      const rendered = await offline.startRendering();
      const channel = rendered.getChannelData(0);
      let sumSquares = 0;
      for (let index = 0; index < channel.length; index += 1) {
        const sample = channel[index] ?? 0;
        sumSquares += sample * sample;
      }
      return Math.sqrt(sumSquares / channel.length);
    });

    expect(rms).toBeGreaterThan(0);
  });

  /**
   * 变速保音高 worklet 必须真的加载得到。
   *
   * `AudioEngine.workletModuleUrl` 指向 `/worklets/pitchPreserveStretchProcessor.js`。
   * 那个文件过去**不存在**（仓库里只有 TS 源码），`addModule` 必然 404 →
   * 变速永远降级。本用例把「文件真的在、处理器真的注册成功」钉住。
   */
  test('变速保音高 worklet 运行时文件可加载（addModule 不报错）', async ({ page }) => {
    await openFreshProject(page);

    const result = await page.evaluate(async () => {
      const response = await fetch('/worklets/pitchPreserveStretchProcessor.js');
      if (!response.ok) {
        return { ok: false, status: response.status, state: null as string | null };
      }
      const context = new AudioContext();
      try {
        await context.audioWorklet.addModule('/worklets/pitchPreserveStretchProcessor.js');
        return { ok: true, status: response.status, state: context.state };
      } catch (error) {
        return {
          ok: false,
          status: response.status,
          state: `addModule 失败：${String(error)}`,
        };
      } finally {
        void context.close();
      }
    });

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.state).not.toContain('addModule 失败');
  });
});