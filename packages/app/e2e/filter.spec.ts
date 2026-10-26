/**
 * 滤镜 e2e：真实导入一段录屏 WebM → 落轨 → 应用「黑白」预设，
 * 用**画布像素**验证预览确已去色；取消后恢复彩色。
 *
 * 覆盖：clip.filter 数据落库 → 合成器 ctx.filter 映射 → 预览重绘全链路。
 */

import { expect, test, type Page } from '@playwright/test';

/** 新建工程并进入编辑器。 */
async function openFreshProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="text"]').first().fill('滤镜验证工程');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await page.waitForSelector('canvas[aria-label="preview"]', { timeout: 20_000 });
}

/** 在页面里录一段彩色 WebM，存到 `window.__e2eClipFile`。 */
async function recordClipFile(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
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
        ctx.fillStyle = `hsl(${(elapsed / 16) % 360} 80% 50%)`;
        ctx.fillRect(0, 0, 160, 120);
        if (elapsed < 1200) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    const w = window as unknown as { __e2eClipFile?: File };
    w.__e2eClipFile = new File([new Blob(chunks, { type: 'video/webm' })], 'filter-e2e.webm', {
      type: 'video/webm',
    });
  });
}

/** 把录好的文件「拖」到窗口上（走 useFileDrop 的 window 监听 → 导入素材）。 */
async function dropFileOnWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __e2eClipFile?: File };
    const file = w.__e2eClipFile;
    if (!file) throw new Error('clip file not recorded');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = document.body;
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
}

/**
 * 采样预览画布，返回「彩色像素占比」。
 *
 * 录屏素材是高饱和 hsl 色，未加滤镜时彩色像素占比接近 1；
 * 「黑白」预设（grayscale(1)）后应接近 0。
 */
async function sampleColorRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="preview"]') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('preview canvas missing');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context missing');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let colored = 0;
    let total = 0;
    // 每 97 个像素采一个，兼顾速度与覆盖率。
    for (let i = 0; i < data.length; i += 4 * 97) {
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      total += 1;
      if (Math.abs(r - g) > 12 || Math.abs(g - b) > 12) colored += 1;
    }
    return total === 0 ? 0 : colored / total;
  });
}

/** 等预览画出非黑画面（帧源异步准备）。 */
async function waitForNonBlackPreview(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector(
        'canvas[aria-label="preview"]',
      ) as HTMLCanvasElement | null;
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let lit = 0;
      for (let i = 0; i < data.length; i += 4 * 101) {
        if ((data[i] as number) + (data[i + 1] as number) + (data[i + 2] as number) > 30) lit += 1;
      }
      return lit > 10;
    },
    undefined,
    { timeout: 20_000 },
  );
}

test.describe('滤镜（Canvas 2D filter）', () => {
  test('黑白预设去色、取消恢复（画布像素级验证）', async ({ page }) => {
    await openFreshProject(page);
    await recordClipFile(page);
    await dropFileOnWindow(page);

    // 素材入库 → 双击卡片落到自动轨道并选中。
    const card = page.getByRole('button', { name: 'filter-e2e.webm' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.dblclick();

    // 选中 clip → 属性面板出现滤镜分区。
    await expect(page.getByRole('heading', { name: /滤镜|Filter/ })).toBeVisible();
    await waitForNonBlackPreview(page);

    // 基线：彩色素材 → 彩色像素占比应很高。
    const before = await sampleColorRatio(page);
    expect(before).toBeGreaterThan(0.5);

    // 应用「黑白」。
    await page.getByRole('button', { name: /^黑白$|^Mono$/ }).click();
    await page.waitForTimeout(300); // 等重绘
    const mono = await sampleColorRatio(page);
    expect(mono).toBeLessThan(0.05);

    // 取消滤镜 → 恢复彩色。
    await page.getByRole('button', { name: /^无$|^None$/ }).click();
    await page.waitForTimeout(300);
    const restored = await sampleColorRatio(page);
    expect(restored).toBeGreaterThan(0.5);
  });
});
