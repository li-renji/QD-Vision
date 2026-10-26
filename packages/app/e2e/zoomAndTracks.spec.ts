/**
 * 回归用例：时间线缩放（Ctrl+滚轮）/ 主轨道顶格 / 轨道删除 / 重命名 / 预览视图缩放。
 *
 * 对应修复：
 * 1. Ctrl+滚轮缩放时间线**不再**触发浏览器整页缩放（原生非被动监听器）；
 * 2. 缩放后轨道不消失（store 与 DOM scrollLeft 对齐）；
 * 3. 新增视频轨主轨道顶格（插到第一条视频轨正下方）；
 * 4. 视频轨可删除（右键菜单 + 二次确认）；
 * 5. 轨道可行内重命名（双击名称）；
 * 6. 预览画面可 Ctrl+滚轮缩放（视图变换）。
 *
 * 选择器约定与仓库现有 e2e 一致：中英双语正则（无头浏览器默认 en-US）。
 */

import { expect, test, type Page } from '@playwright/test';

/** 进入编辑器：新建工程。 */
async function enterEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="text"]').first().fill('回归测试工程');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await expect(page.getByRole('heading', { name: /素材库|Media/ })).toBeVisible();
}

/** 通过工具栏新增一条指定类型的轨道。 */
async function addTrackViaToolbar(page: Page, typeName: RegExp): Promise<void> {
  await page.getByRole('button', { name: /新增轨道|Add track/ }).click();
  await page.getByRole('menuitem', { name: typeName }).click();
}

/** 视频轨 / 音频轨菜单项名（中英）。 */
const VIDEO_TRACK = /视频轨|Video track/;
const AUDIO_TRACK = /音频轨|Audio track/;

/** 读取时间线缩放读数（px/s）。 */
async function readZoomLabel(page: Page): Promise<number> {
  const text = await page.getByText(/\d+px\/s/).first().innerText();
  return Number(/(\d+)px\/s/.exec(text)?.[1] ?? '0');
}

test.describe('时间线缩放（Ctrl+滚轮）', () => {
  test('Ctrl+滚轮缩放时间线，且不触发浏览器整页缩放', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enterEditor(page);
    await addTrackViaToolbar(page, VIDEO_TRACK);

    const before = await readZoomLabel(page);
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    // 在时间线区域中心按 Ctrl+滚轮向上（放大）。
    const timeline = page.locator('[data-timeline-area]');
    const box = await timeline.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');

    const after = await readZoomLabel(page);
    const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    // 1) 时间线刻度确实被缩放了；
    expect(after).toBeGreaterThan(before);
    // 2) 浏览器视口没有被缩放（修复前这里会 > 1）。
    expect(scaleAfter).toBe(scaleBefore);
    // 3) 缩放后轨道行仍然在（修复前会「消失」）。
    await expect(page.locator('[data-track-row]')).toHaveCount(1);

    expect(errors).toEqual([]);
  });
});

test.describe('主轨道顶格', () => {
  test('先有音频轨时，新增视频轨插到最顶部（顶格）', async ({ page }) => {
    await enterEditor(page);
    await addTrackViaToolbar(page, AUDIO_TRACK);
    await addTrackViaToolbar(page, VIDEO_TRACK);

    // 轨道头按视觉顺序渲染：视频轨应在音频轨之上。
    const headers = page.locator('[data-track-header]');
    await expect(headers).toHaveCount(2);
    await expect(headers.nth(0)).toContainText(VIDEO_TRACK);
    await expect(headers.nth(1)).toContainText(AUDIO_TRACK);
  });

  test('连续新增视频轨，第二条紧跟主轨', async ({ page }) => {
    await enterEditor(page);
    await addTrackViaToolbar(page, VIDEO_TRACK);
    await addTrackViaToolbar(page, VIDEO_TRACK);

    const headers = page.locator('[data-track-header]');
    await expect(headers).toHaveCount(2);
    await expect(headers.nth(0)).toContainText(/视频轨 1|Video track 1/);
    await expect(headers.nth(1)).toContainText(/视频轨 2|Video track 2/);
  });
});

test.describe('轨道删除与重命名', () => {
  test('右键菜单可删除视频轨（二次确认后生效）', async ({ page }) => {
    await enterEditor(page);
    await addTrackViaToolbar(page, VIDEO_TRACK);
    await addTrackViaToolbar(page, AUDIO_TRACK);
    await expect(page.locator('[data-track-row]')).toHaveCount(2);

    // 右键视频轨轨道头 → 删除轨道。
    await page
      .locator('[data-track-header]', { hasText: VIDEO_TRACK })
      .first()
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: /删除轨道|Remove track/ }).click();

    // 二次确认对话框。
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^删除$|^Delete$/ }).click();

    await expect(page.locator('[data-track-row]')).toHaveCount(1);
    await expect(page.locator('[data-track-header]').first()).toContainText(AUDIO_TRACK);
  });

  test('双击轨道名可行内重命名', async ({ page }) => {
    await enterEditor(page);
    await addTrackViaToolbar(page, VIDEO_TRACK);

    const header = page.locator('[data-track-header]').first();
    await header.getByText(/视频轨 1|Video track 1/).dblclick();

    const input = page.getByRole('textbox', { name: /重命名轨道|Rename track/ });
    await expect(input).toBeVisible();
    await input.fill('主轨道');
    await input.press('Enter');

    await expect(page.locator('[data-track-header]').first()).toContainText('主轨道');
  });
});

test.describe('预览视图缩放', () => {
  test('Ctrl+滚轮缩放预览画面（百分比读数变化，可复位）', async ({ page }) => {
    await enterEditor(page);

    // 预览控制条：无素材时黑毯，读数仍为 100%。
    const zoomLabel = page.getByText(/^\d+%$/);
    await expect(zoomLabel).toHaveText('100%');

    // 悬停预览画布区域后 Ctrl+滚轮。
    const canvas = page.locator('canvas[aria-label="preview"]');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');

    await expect(zoomLabel).not.toHaveText('100%');

    // 点「适应」复位（作用域限定在预览控制条内，避开画布设置的 Fit 选择器）。
    const controls = zoomLabel.locator('..');
    await controls.getByRole('button', { name: /^适应$|^Fit$/ }).click();
    await expect(zoomLabel).toHaveText('100%');
  });
});
