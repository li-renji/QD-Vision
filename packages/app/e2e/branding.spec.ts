/**
 * 品牌与排版回归测试（把一次性的浏览器人工核查固化成可执行断言）。
 *
 * 覆盖 4 类曾经出过问题的点：
 * 1. **品牌**：标题 / 顶栏 / manifest 都必须是 QD视界，且界面上不残留旧名；
 * 2. **字体**：CSS 里不得再引用从未加载的 Web 字体（`Inter` / `Noto Sans SC`），
 *    且不得残留指向 Google Fonts 的 `preconnect`（死代码 + 拖慢首屏 + 离线必失败）；
 * 3. **轨道头对齐**：轨道头与轨道行必须逐个 `top`/`height` 对齐。
 *    历史缺陷是轨道头用 `h-full` 而非 `track.height`，导致第 2 个轨道头下移 260px；
 * 4. **轨道名可读**：轨道名必须是单行（高度不超 1.5 倍行高）且有可读宽度，
 *    不能被图标挤成极窄一列（历史实测最坏只剩 8px）。
 */

import { expect, test, type Page } from '@playwright/test';

/**
 * 打开应用首页并等待 React 挂载完成。
 *
 * ## 为什么不用默认的 `waitUntil: 'load'`
 *
 * `page.goto('/')` 默认等 `load` 事件 —— 它要求**所有**子资源（script /
 * modulepreload / stylesheet）都完成。本仓的 e2e 由 `vite preview` 提供服务，
 * 而 `preview` 服务的是磁盘上的 `dist/`。当**另一个进程正在重建 `dist/`**
 * （vite build 会先清空再重写）时，`index.html` 可能被读到**半截**：
 * 实测出现过标题为空字符串、以及 `goto` 卡在 "waiting until load" 直到超时。
 *
 * 这里改成等 `domcontentloaded`（HTML 解析完即可拿到 `<title>`），
 * 再显式等 `#root` 出现子节点（React 挂载完成），两者都不依赖静态资源的
 * 完整下载，对共享构建目录的短暂竞态免疫。
 */
async function gotoApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const root = document.querySelector('#root');
    return !!root && root.childElementCount > 0;
  });
}

/** 新建工程并进入编辑器。 */
async function enterEditor(page: Page): Promise<void> {
  await gotoApp(page);
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="text"]').first().fill('排版回归测试工程');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await expect(page.getByRole('heading', { name: /素材库|Media/ })).toBeVisible();
}

test.describe('品牌与排版回归', () => {
  test('应用标题与顶栏品牌名为 QD视界', async ({ page }) => {
    await gotoApp(page);
    await expect(page).toHaveTitle('QD视界');

    await enterEditor(page);
    // 顶栏应用名
    await expect(page.getByText('QD视界', { exact: true }).first()).toBeVisible();
    // 界面上不应再出现旧品牌名
    await expect(page.locator('body')).not.toContainText('ClipCut');
  });

  test('manifest 的 name / short_name 均为 QD视界', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();
    const manifest = (await res.json()) as { name: string; short_name: string };
    expect(manifest.name).toBe('QD视界');
    expect(manifest.short_name).toBe('QD视界');
  });

  test('不再引用从未加载的 Web 字体，也无 Google Fonts preconnect', async ({ page }) => {
    await gotoApp(page);

    // 死 preconnect 必须清干净
    const preconnects = await page.locator('link[rel="preconnect"]').evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLLinkElement).href),
    );
    expect(preconnects.filter((href) => href.includes('fonts.googleapis'))).toEqual([]);
    expect(preconnects.filter((href) => href.includes('fonts.gstatic'))).toEqual([]);

    // 字体栈不得出现无 @font-face 支撑的 Web 字体名
    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily).not.toMatch(/Inter/);
    expect(fontFamily).not.toMatch(/Noto Sans SC/);

    // 必须落到中文系统字体上，否则中文会退回到无衬线默认字形
    expect(fontFamily).toMatch(/PingFang SC|Microsoft YaHei|Noto Sans CJK|Hiragino/);
  });

  test('轨道头与轨道行逐个对齐（top 与 height 同时相等）', async ({ page }) => {
    await enterEditor(page);

    const pairs = await page.evaluate(() => {
      // 轨道头**列容器**也带 w-trackhead 类，必须取它的直接子元素，否则下标错位一位
      const rail = document.querySelector('.w-trackhead > .w-trackhead')?.parentElement;
      const heads = rail
        ? [...rail.children].filter((c) => c.classList.contains('w-trackhead'))
        : [];
      const rows = [
        ...document.querySelectorAll('.w-trackhead + div .relative.flex.flex-col > div'),
      ];
      return heads.map((h, i) => {
        const hb = h.getBoundingClientRect();
        const rb = rows[i]?.getBoundingClientRect();
        return {
          headTop: Math.round(hb.top),
          headH: Math.round(hb.height),
          rowTop: rb ? Math.round(rb.top) : null,
          rowH: rb ? Math.round(rb.height) : null,
        };
      });
    });

    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.rowTop, '轨道头应与轨道行一一对应').toBe(p.headTop);
      expect(p.rowH, '轨道头高度必须等于 track.height').toBe(p.headH);
    }
  });

  test('轨道名保持单行且有可读宽度（不被图标挤成竖条）', async ({ page }) => {
    await enterEditor(page);

    const names = await page.evaluate(() => {
      const rail = document.querySelector('.w-trackhead > .w-trackhead')?.parentElement;
      const heads = rail
        ? [...rail.children].filter((c) => c.classList.contains('w-trackhead'))
        : [];
      return heads.map((h) => {
        const s = h.querySelector<HTMLElement>('span[title]');
        if (!s) return null;
        const r = s.getBoundingClientRect();
        const cs = getComputedStyle(s);
        return {
          label: s.textContent ?? '',
          width: Math.round(r.width),
          height: Math.round(r.height),
          lineHeight: parseFloat(cs.lineHeight),
        };
      });
    });

    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      if (!n) continue;
      expect(n.label.length).toBeGreaterThan(0);
      // 单行：高度不得超过 1.6 倍行高（换行/竖排会显著超过）
      expect(n.height, `「${n.label}」被折行成多行`).toBeLessThanOrEqual(n.lineHeight * 1.6);
      // 可读宽度：历史最坏情况只剩 8px（挤成竖条）
      expect(n.width, `「${n.label}」可用宽度过窄`).toBeGreaterThanOrEqual(60);
    }
  });
});