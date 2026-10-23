/**
 * 播放链路端到端测试（预览全黑 / 播放头不动的回归防护）。
 *
 * ## 为什么需要这条
 *
 * 用户实测反馈：「点击播放，指针不走，没有画面」。这是**两个独立缺陷**：
 * 1.没有播放时钟 → `currentTimeMs` 永不推进 → 播放头不动；
 * 2. `PreviewCanvas` 没把 `getFrame` 传给 `renderFrame` → 视频图层永不绘制。
 *
 * 两者都**无法**被单元测试完全覆盖：单元测试能证明「取帧器能返回帧」，
 * 但证明不了「合成器真的用上了它」；也能证明时钟会推进，但证明不了
 * 「真实浏览器里 `<video>` 真能解码并画出来」。这条 e2e 补的就是这两块。
 *
 * ## 测试视频从哪来
 *
 * **不用提交二进制夹具** —— 直接在页面里用 `canvas.captureStream()` +
 * `MediaRecorder` 现场录一段 WebM，内容是**逐帧递增的色相**。
 * 于是「画面是否在更新」可以用**主色相**客观断言，而不是肉眼看截图。
 */

import { expect, test, type Page } from '@playwright/test';

/** 在页面里录一段逐帧变色��� WebM，并触发一次全局 drop 完成导入。 */
async function importGeneratedClip(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');

    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start();

    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const draw = (): void => {
        const elapsed = performance.now() - startedAt;
        // 色相随时间递增 → 可用主色相客观判断「帧是否在更新」
        ctx.fillStyle = `hsl(${(elapsed / 16) % 360} 90% 55%)`;
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 320, 8);
        if (elapsed < 4000) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'e2e-clip.webm', {
      type: 'video/webm',
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    // 素材导入走全窗口 drop（见 hooks/useFileDrop.ts）
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });

  // 等待导入 + 元数据探测（读时长/分辨率）
  await expect
    .poll(async () => page.locator('text=e2e-clip.webm').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/** 采样预览画布：非黑像素占比 + 中心主色相。 */
async function sampleCanvas(page: Page): Promise<{ nonBlackRatio: number; hue: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="preview"]');
    if (!canvas) return { nonBlackRatio: 0, hue: -1 };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { nonBlackRatio: 0, hue: -1 };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const x0 = Math.floor(canvas.width * 0.25);
    const x1 = Math.floor(canvas.width * 0.75);
    const y0 = Math.floor(canvas.height * 0.25);
    const y1 = Math.floor(canvas.height * 0.75);

    let nonBlack = 0;
    let total = 0;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let samples = 0;

    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        const i = (y * canvas.width + x) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        total += 1;
        if (r + g + b > 30) nonBlack += 1;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) {
          rSum += r;
          gSum += g;
          bSum += b;
          samples += 1;
        }
      }
    }

    const n = Math.max(1, samples);
    const r = rSum / n;
    const g = gSum / n;
    const b = bSum / n;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { nonBlackRatio: nonBlack / total, hue };
  });
}

/** 读取顶部工具栏的时间码文本（形如 `00:00:01:23 / 00:00:05:00`）。 */
async function readTimecode(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    const text = header?.innerText.replace(/\s+/g, ' ') ?? '';
    return text.match(/\d{2}:\d{2}:\d{2}:\d{2}/)?.[0] ?? null;
  });
}

/** 新建工程并进入编辑器。 */
async function openFreshProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="text"]').first().fill('e2e 播放验证');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await page.waitForSelector('canvas[aria-label="preview"]', { timeout: 20_000 });
}

test.describe('播放链路（播放头 + 预览画面）', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // 保证 video.play() 不被自动播放策略拦截
      // @ts-expect-error 测试环境覆写
      HTMLMediaElement.prototype.play = () => Promise.resolve();
    });
  });

  test('导入视频 → 加入时间线 → 播放：时间码前进且画面非黑', async ({ page }) => {
    await openFreshProject(page);
    await importGeneratedClip(page);

    // 播放前：画布只有背景色
    const before = await sampleCanvas(page);
    expect(before.nonBlackRatio).toBeLessThan(0.05);

    // 双击素材卡片 → 追加到时间线播放头处（MediaCard 的 onDoubleClick）
    await page.locator('text=e2e-clip.webm').first().dblclick();
    await page.waitForTimeout(800);

    // 播放
    const beforeTc = await readTimecode(page);
    await page.locator('button[aria-label*="播放"], button[aria-label*="Play"]').first().click();
    await page.waitForTimeout(1500);

    const afterTc = await readTimecode(page);
    expect(afterTc).not.toBeNull();
    expect(afterTc).not.toBe(beforeTc); // 标准 1：时间码前进

    const after = await sampleCanvas(page);
    expect(after.nonBlackRatio).toBeGreaterThan(0.5); // 标准 2：画面非黑
  });

  test('播放中画面持续更新（不是静止的同一帧）', async ({ page }) => {
    await openFreshProject(page);
    await importGeneratedClip(page);
    await page.locator('text=e2e-clip.webm').first().dblclick();
    await page.waitForTimeout(800);
    await page.locator('button[aria-label*="播放"], button[aria-label*="Play"]').first().click();

    // 视频内容色相逐帧递增 → 多次采样的主色相必须不同
    const hues: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      hues.push((await sampleCanvas(page)).hue);
      await page.waitForTimeout(500);
    }
    expect(new Set(hues).size).toBeGreaterThan(1);
  });

  test('播放到工程末尾自动停止（不循环、不无限跑）', async ({ page }) => {
    await openFreshProject(page);
    await importGeneratedClip(page);
    await page.locator('text=e2e-clip.webm').first().dblclick();
    await page.waitForTimeout(800);
    await page.locator('button[aria-label*="播放"], button[aria-label*="Play"]').first().click();

    // 4s 的 clip：等它播完（留足余量）
    await page.waitForTimeout(6000);

    const stopped = await readTimecode(page);
    await page.waitForTimeout(1200);
    const stillStopped = await readTimecode(page);

    expect(stillStopped).toBe(stopped); // 标准 3：时间码不再增长
  });

  test('一次拖拽只导入一个素材（重复导入回归防护）', async ({ page }) => {
    await openFreshProject(page);
    await importGeneratedClip(page);

    // 素材卡片刻意用唯一文件名，直接数 DOM 节点即可断言「只导入了一个」。
    // （背景：useFileDrop 曾被 App.tsx 与 MediaPanel.tsx 同时注册在 window 上，
    //   一次 drop 触发两次 importFiles —— 详见 hooks/useFileDrop.ts 文件头。）
    await expect
      .poll(async () => page.locator('text=e2e-clip.webm').count(), { timeout: 10_000 })
      .toBe(1);
  });

  /**
   * 空工程禁用播放（剪辑软件惯例）。
   *
   * 背景：新建工程后时间线是空的，用户第一次点播放会「按了没反应」，
   * 从而误以为功能坏了。这里断言按钮置灰且给出提示文案。
   *
   * 注意：底层时钟在空工程下**依然能正常推进**（由 playbackClock 的空工程
   * 单测覆盖），UI 禁用只是不给入口，两者互不依赖。
   */
  test('空工程时播放按钮禁用并提示「先添加素材」，加入 clip 后恢复可用', async ({ page }) => {
    await openFreshProject(page);

    // 文案随 locale 变化（zh: 播放/请先添加素材到时间线；en: Play/Add media...），
    // 因此用中英双语正则定位，避免依赖浏览器语言。
    const EMPTY_HINT = /请先添加素材到时间线|Add media to the timeline first/;
    const PLAY_LIKE = /播放|暂停|Play|Pause|请先添加素材到时间线|Add media to the timeline first/;
    const playButtons = page.locator('button[aria-label*="播放"], button[aria-label*="暂停"], button[aria-label*="Play"], button[aria-label*="Pause"], button[aria-label*="素材"], button[aria-label*="media"]');
    // 顶栏与预览控件各有一个播放按钮，两者都应禁用
    await expect(playButtons).toHaveCount(2);
    for (let i = 0; i < 2; i += 1) {
      await expect(playButtons.nth(i)).toBeDisabled();
      await expect(playButtons.nth(i)).toHaveAttribute('aria-label', EMPTY_HINT);
    }

    // 强制点击也不应开始播放（时间码保持 0）
    await playButtons.first().click({ force: true });
    await page.waitForTimeout(800);
    expect(await readTimecode(page)).toBe('00:00:00:00');

    // 加入 clip 后恢复可用
    await importGeneratedClip(page);
    await page.locator('text=e2e-clip.webm').first().dblclick();
    await page.waitForTimeout(1000);

    await expect(playButtons).toHaveCount(2);
    for (let i = 0; i < 2; i += 1) {
      await expect(playButtons.nth(i)).toBeEnabled();
      await expect(playButtons.nth(i)).toHaveAttribute('aria-label', PLAY_LIKE);
    }
  });
});