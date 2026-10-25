/**
 * 时间线拖放 e2e（轨道内提示浮层 + 命中轨道才导入 + 无孤儿素材）。
 *
 * 覆盖用户反馈：
 * - 拖素材到轨道区域时，**轨道内**（非全屏）出现黑色提示浮层；
 * - 拖入轨道成功后浮层消失、片段落轨；
 * - 拖到轨道**以外**（标尺等）不导入 —— 素材库不冒出孤儿素材。
 *
 * 说明：Playwright 的鼠标操作不会触发原生 HTML5 拖拽，因此这里在页面内
 * 用真实 `DataTransfer` + `dispatchEvent` 合成 `dragenter/dragover/drop`。
 */

import { expect, test, type Page } from '@playwright/test';

/** 新建工程并进入编辑器。 */
async function openFreshProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="text"]').first().fill('e2e 拖放验证');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await page.waitForSelector('canvas[aria-label="preview"]', { timeout: 20_000 });
}

/** 在页面里录一段 WebM，存到 `window.__e2eClipFile` 供合成 DataTransfer。 */
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
    w.__e2eClipFile = new File([new Blob(chunks, { type: 'video/webm' })], 'drop-e2e.webm', {
      type: 'video/webm',
    });
  });
}

/**
 * 在页内合成拖拽序列。
 *
 * @param mode 'row'   在第一条轨道行中心
 * @param mode 'area'  在时间线区域中心
 * @param mode 'ruler' 在第一条轨道行**上方**（标尺区，命中不到任何轨道）
 */
async function simulateDrag(
  page: Page,
  mode: 'row' | 'area' | 'ruler',
  options: { drop: boolean },
): Promise<void> {
  await page.evaluate(
    ({ mode: m, drop }) => {
      const w = window as unknown as { __e2eClipFile?: File };
      const file = w.__e2eClipFile;
      if (!file) throw new Error('clip file not recorded');

      let target: Element | null = null;
      let clientX = 0;
      let clientY = 0;
      if (m === 'row') {
        target = document.querySelector('[data-track-row]');
        const r = target?.getBoundingClientRect();
        if (!r) throw new Error('no track row');
        clientX = r.left + r.width * 0.5;
        clientY = r.top + r.height * 0.5;
      } else if (m === 'area') {
        target = document.querySelector('[data-timeline-area]');
        const r = target?.getBoundingClientRect();
        if (!r) throw new Error('no timeline area');
        clientX = r.left + r.width * 0.5;
        clientY = r.top + r.height * 0.5;
      } else {
        // ruler：轨道行上方 8px
        target = document.querySelector('[data-track-row]');
        const r = target?.getBoundingClientRect();
        if (!r) throw new Error('no track row');
        clientX = r.left + r.width * 0.5;
        clientY = r.top - 8;
      }

      const fire = (type: string, el: Element): void => {
        const dt = new DataTransfer();
        dt.items.add(file);
        el.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
          }),
        );
      };
      fire('dragenter', target);
      fire('dragover', target);
      if (drop) fire('drop', target);
    },
    { mode, drop: options.drop },
  );
}

const HINT = /松开以导入到轨道|Drop to import/;

test.describe('时间线拖放（轨道内浮层 / 命中才导入 / 无孤儿素材）', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error 测试环境覆写，避免自动播放策略拦截
      HTMLMediaElement.prototype.play = () => Promise.resolve();
    });
  });

  test('悬停轨道区域显示轨道内提示浮层，拖离后消失', async ({ page }) => {
    await openFreshProject(page);
    await recordClipFile(page);

    // 空时间线：拖到时间线区域 → 先自动建轨 + 落一个片段
    await simulateDrag(page, 'area', { drop: true });
    await expect(page.locator('[data-track-row]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-clip-id]')).toHaveCount(1, { timeout: 10_000 });

    // 有轨道后：悬停轨道行 → 轨道内浮层出现（不是全屏 fixed）
    await simulateDrag(page, 'row', { drop: false });
    await expect(page.getByText(HINT)).toBeVisible();

    // 拖离时间线 → 浮层消失（单独派发一次 dragleave，避免重复 dragenter 抬深度）
    await page.evaluate(() => {
      document
        .querySelector('[data-timeline-area]')
        ?.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByText(HINT)).toBeHidden();
  });

  test('拖文件到轨道成功落轨；拖到轨道以外（标尺）不导入、无孤儿素材', async ({ page }) => {
    await openFreshProject(page);
    await recordClipFile(page);

    // 先导入素材库 + 双击加入时间线 → 建视频轨 + 片段#1
    await page.evaluate(() => {
      const w = window as unknown as { __e2eClipFile?: File };
      const file = w.__e2eClipFile;
      if (!file) throw new Error('no file');
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('text=drop-e2e.webm').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('text=drop-e2e.webm').first().dblclick();
    await expect(page.locator('[data-clip-id]')).toHaveCount(1, { timeout: 10_000 });

    // 录第二段，拖到已有视频轨 → 落轨（1 → 2）
    await recordClipFile(page);
    await simulateDrag(page, 'row', { drop: true });
    await expect(page.locator('[data-clip-id]')).toHaveCount(2, { timeout: 15_000 });

    // 拖到标尺（轨道以外）→ 不导入：素材库素材数、片段数都不变
    const assetsBefore = await page.locator('text=drop-e2e.webm').count();
    await simulateDrag(page, 'ruler', { drop: true });
    await page.waitForTimeout(600);
    expect(await page.locator('text=drop-e2e.webm').count()).toBe(assetsBefore);
    expect(await page.locator('[data-clip-id]').count()).toBe(2);
  });
});
