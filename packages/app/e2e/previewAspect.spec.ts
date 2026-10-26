/**
 * 预览窗 e2e：标准比例显示 / 比例切换 / 拖动视频移动 clip。
 *
 * 对应用户反馈的三点：
 * (a) 视频在预览窗里的拖动 —— 左键拖动视频本体即可移动 clip（剪映式）；
 * (b) 预览窗按标准比例显示 —— 画布渲染宽高比必须等于画布宽高比；
 * (c) 比例可调整 —— 切换比例下拉，画布像素与显示比例同步变化。
 *
 * 断言手段：
 * - 比例显示：读 `<canvas>` 的 boundingBox，宽/高 ≈ 画布宽高比；
 * - 比例切换：读 canvas 的 width/height 属性（后备存储）+ boundingBox 比例；
 * - 拖动：读页面暴露的 `__clipcutPreviewTransform()`（选中 clip 的 transform），
 *   拖动后 x/y 增大 —— 比像素对比稳定，且直接证明 clip 数据被改写。
 */

import { expect, test, type Page } from '@playwright/test';

interface PreviewTransform {
  clipId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** 读取当前选中 clip 的 transform 快照（PreviewCanvas 暴露的只读诊断）。 */
async function readPreviewTransform(page: Page): Promise<PreviewTransform | null> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __clipcutPreviewTransform?: () => PreviewTransform | null;
    };
    return scope.__clipcutPreviewTransform ? scope.__clipcutPreviewTransform() : null;
  });
}

/** 在页面里录一段带声音的 WebM（VP8 + Opus）并触发导入。 */
async function importClipWithAudio(page: Page): Promise<void> {
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
    gain.gain.value = 0.6;
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
    .poll(async () => page.locator('text=e2e-audio.webm').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/** 新建工程并进入编辑器。 */
async function openFreshProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="text"]').first().fill('e2e 预览窗验证');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await page.waitForSelector('canvas[aria-label="preview"]', { timeout: 20_000 });
}

/** 把素材加入时间线（双击素材卡片）并等待就绪。 */
async function addToTimeline(page: Page, fileName: string): Promise<void> {
  await page.locator(`text=${fileName}`).first().dblclick();
  await page.waitForTimeout(1500);
}

/** 画布当前渲染宽高比。 */
async function canvasRatio(page: Page): Promise<number> {
  const canvas = page.locator('canvas[aria-label="preview"]');
  const box = await canvas.boundingBox();
  if (!box || box.height === 0) return 0;
  return box.width / box.height;
}

test.describe('预览窗：比例显示 / 比例切换 / 拖动视频', () => {
  test('画布按标准宽高比显示（默认 16:9）', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'e2e-audio.webm');

    // 等 ResizeObserver 测出容器并把画布摆正
    await expect.poll(() => canvasRatio(page), { timeout: 10_000 }).toBeGreaterThan(1.7);
    const ratio = await canvasRatio(page);
    expect(ratio).toBeLessThan(1.85);
  });

  test('切换比例为 9:16：画布像素与显示比例同步变为竖版', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'e2e-audio.webm');

    // 打开比例下拉（aria-label = 「比例 / Ratio」），选 9:16
    await page.getByRole('button', { name: /比例|Ratio/ }).click();
    await page.getByRole('menuitem', { name: '9:16' }).click();

    const canvas = page.locator('canvas[aria-label="preview"]');
    // 后备存储变为 1080×1920（resizeCanvas 生效）
    await expect.poll(async () => canvas.getAttribute('width'), { timeout: 10_000 }).toBe('1080');
    expect(await canvas.getAttribute('height')).toBe('1920');
    // 显示宽高比随之变为竖版（≈0.5625）
    await expect.poll(() => canvasRatio(page), { timeout: 10_000 }).toBeLessThan(0.6);
    const ratio = await canvasRatio(page);
    expect(ratio).toBeGreaterThan(0.53);
  });

  test('在预览窗拖动视频本体可移动 clip（transform.x/y 增大）', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'e2e-audio.webm');

    const canvas = page.locator('canvas[aria-label="preview"]');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 单击画面中心选中 clip
    await page.mouse.click(cx, cy);
    await expect.poll(async () => (await readPreviewTransform(page)) !== null, { timeout: 5000 }).toBe(
      true,
    );
    const before = await readPreviewTransform(page);
    expect(before).not.toBeNull();
    if (!before) return;

    // 从中心向右下拖动视频
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 70, cy + 25, { steps: 10 });
    await page.mouse.up();

    // clip 被移动：x、y 均增大（归一化坐标）
    await expect
      .poll(async () => (await readPreviewTransform(page))?.x ?? 0, { timeout: 5000 })
      .toBeGreaterThan(before.x + 0.02);
    const after = await readPreviewTransform(page);
    expect(after?.y ?? 0).toBeGreaterThan(before.y + 0.005);
  });
});
