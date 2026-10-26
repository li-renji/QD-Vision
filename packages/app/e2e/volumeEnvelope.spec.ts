/**
 * 音量包络（横线 + 可调节节点）端到端测试。
 *
 * ## 验收点
 *
 * 参考剪映 / CapCut：视频 / 音轨上的片段里有一条横线，双击横线任意位置新增
 * 一个可拖拽节点，拖动节点上下改音量（0~2）、左右改时间，双击节点删除它。
 *
 * 这里用「SVG 内 `<circle>` 节点数量 + 坐标」来断言，因为它直接反映
 * `clip.audio.envelope` 的渲染结果：
 *
 * - 空包络 → 0 个 circle（只有横线与折线，无节点）；
 * - 双击横线 → 新增 1 个 circle，且**重渲染后仍在**（说明已写回 store，
 *   节点来自 `clip.audio.envelope` 而非本地草稿）；
 * - 双击节点 → 该 circle 消失（回到 0 个）；
 * - 拖动节点 → 节点 `cy` 改变（增益随时间变化，曲线随之变形）。
 *
 * 不依赖任何音频输出设备，纯 DOM 断言即可稳定回归「横线 + 节点」这条交互。
 */

import { expect, test } from '@playwright/test';

/** 在页面里录一段带声音的 WebM（VP8 视频 + Opus 音频）并触发导入。 */
async function importClipWithAudio(page: import('@playwright/test').Page): Promise<void> {
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
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });

  await expect
    .poll(async () => page.locator('text=e2e-audio.webm').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/** 新建工程并进入编辑器。 */
async function openFreshProject(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建工程|New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="text"]').first().fill('e2e 音量包络');
  await dialog.getByRole('button', { name: /创建|Create/ }).click();
  await page.waitForSelector('canvas[aria-label="preview"]', { timeout: 20_000 });
}

/** 把素材加入时间线（双击素材卡片）并等待就绪。 */
async function addToTimeline(page: import('@playwright/test').Page, fileName: string): Promise<void> {
  await page.locator(`text=${fileName}`).first().dblclick();
  await page.waitForTimeout(1500);
}

test.describe('音量包络（横线 + 可调节节点）', () => {
  test('双击横线新增节点、双击节点删除节点', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'e2e-audio.webm');

    // 片段上应渲染出音量包络 SVG
    const envelope = page.locator('[data-volume-envelope]').first();
    await expect(envelope).toBeVisible({ timeout: 10_000 });

    // 初始：空包络 → 0 个节点
    await expect(envelope.locator('circle')).toHaveCount(0);

    const box = (await envelope.boundingBox()) ?? { x: 0, y: 0, width: 300, height: 40 };

    // 双击横线左半段 → 新增 1 个节点
    await envelope.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
    await expect
      .poll(async () => envelope.locator('circle').count(), { timeout: 10_000 })
      .toBe(1);

    // 双击横线右半段 → 再新增 1 个节点（共 2 个）
    await envelope.dblclick({ position: { x: box.width * 0.7, y: box.height * 0.6 } });
    await expect
      .poll(async () => envelope.locator('circle').count(), { timeout: 10_000 })
      .toBe(2);

    // 双击第一个节点 → 删除它（剩 1 个）。节点来自 store 状态，删除后也稳定保留。
    await envelope.locator('circle').first().dblclick();
    await expect
      .poll(async () => envelope.locator('circle').count(), { timeout: 10_000 })
      .toBe(1);
  });

  test('拖动节点改变曲线（增益随时间变化）', async ({ page }) => {
    await openFreshProject(page);
    await importClipWithAudio(page);
    await addToTimeline(page, 'e2e-audio.webm');

    const envelope = page.locator('[data-volume-envelope]').first();
    await expect(envelope).toBeVisible({ timeout: 10_000 });
    await expect(envelope.locator('circle')).toHaveCount(0);

    const box = (await envelope.boundingBox()) ?? { x: 0, y: 0, width: 300, height: 40 };

    // 中点新增一个节点
    await envelope.dblclick({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
    const node = envelope.locator('circle').first();
    await expect(node).toBeVisible({ timeout: 10_000 });

    const cyBefore = Number(await node.getAttribute('cy'));

    // 拖动节点向下（增益降低 → cy 增大）。幅度保持在细条高度内，
    // 避免指针移出 clip 的 overflow 区域（细条仅 28px）。
    const nodeBox = (await node.boundingBox()) ?? { x: box.x, y: box.y, width: 10, height: 10 };
    const startX = nodeBox.x + nodeBox.width / 2;
    const startY = nodeBox.y + nodeBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 8, { steps: 5 });
    await page.mouse.up();

    // 节点坐标随拖拽改变（重渲染后来自 store，说明增益被改写了）
    await expect
      .poll(async () => Number(await node.getAttribute('cy')), { timeout: 10_000 })
      .not.toBe(cyBefore);
  });
});
