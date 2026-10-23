/**
 * Playwright 冒烟测试（FR / PRD §8.1 闭环的可执行子集）。
 *
 * 覆盖：
 * 1. 应用能启动并显示工程列表；
 * 2. 能新建工程并进入编辑器；
 * 3. 导出面板能打开且不崩溃（不执行真实编码）。
 */

import { expect, test } from '@playwright/test';

test.describe('ClipCut Web 冒烟', () => {
  test('应用启动并显示工程列表', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /我的工程|My projects/ })).toBeVisible();
  });

  test('可以新建工程并进入编辑器', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /新建工程|New project/ }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const nameInput = dialog.locator('input[type="text"]').first();
    await nameInput.fill('冒烟测试工程');

    await dialog.getByRole('button', { name: /创建|Create/ }).click();

    // 进入编辑器：应出现素材面板与时间线
    await expect(page.getByRole('heading', { name: /素材库|Media/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /开始导出|Start export/ })).toBeVisible();
  });

  test('导出面板可打开且不崩溃', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /创建|Create/ }).click();

    // 右侧属性面板在无选中时显示导出设置
    const exportButton = page.getByRole('button', { name: /开始导出|Start export/ });
    await expect(exportButton).toBeVisible();

    // 打开设置面板（能力矩阵）
    await page.getByRole('button', { name: /设置|Settings/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
