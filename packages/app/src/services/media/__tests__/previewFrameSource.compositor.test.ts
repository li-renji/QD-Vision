/**
 * 预览取帧 → 合成器 的端到端接线测试（预览画布全黑的根因回归防护）。
 *
 * ## 这个文件为什么必须存在
 *
 * 根因不是「取帧实现错了」，而是 **`PreviewCanvas` 压根没把 `getFrame` 传给
 * `renderFrame`** —— 于是 `compositor.drawVideoClip` 在 `if (!getFrame) return;`
 * 处直接返回，视频图层永不绘制。
 *
 * 单元测试（`previewFrameSource.test.ts`）只能证明「取帧器能返回帧」，
 * 证明不了「合成器真的用上了它」。本文件把两者接起来，断言
 * **`drawImage` 真的被调用** —— 这正是「画面从全黑变成有内容」的可观测证据。
 *
 * ⚠️ 本文件**不改** `renderFrame` 的签名，也不碰导出路径：
 * `webCodecsExporter` / `mediaRecorderExporter` / `exportController` 仍按原样传帧。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, ProjectDoc } from '@clipcut/shared-types';
import { deserialize } from '../../../domain/project/deserialize.js';
import { renderFrame } from '../../../render/compositor.js';
import { readFixtureJson } from '../../../test/fixtures.js';
import { createPreviewFrameSource, type PreviewFrameSource } from '../previewFrameSource.js';

/** 记录绘制调用的假 2D 上下文。 */
interface MockContext {
  calls: string[];
  ctx: CanvasRenderingContext2D;
}

/** 构造一个可记录调用的假 2D 上下文。 */
function createMockContext(): MockContext {
  const calls: string[] = [];
  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    miterLimit: 10,
    letterSpacing: '0px',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    fillRect: () => calls.push('fillRect'),
    drawImage: () => calls.push('drawImage'),
    fillText: (text: string) => calls.push(`fillText:${text}`),
    strokeText: (text: string) => calls.push(`strokeText:${text}`),
    measureText: (text: string) => ({ width: text.length * 10 }),
  };
  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** 假 `<video>`：能被合成器路径驱动。 */
class FakeVideoElement extends EventTarget {
  src = '';
  currentTime = 0;
  readyState = 4;
  playbackRate = 1;
  muted = true;
  playsInline = true;
  preload = '';
  paused = true;
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  load(): void {
    /* no-op */
  }
  removeAttribute(): void {
    /* no-op */
  }
}

/** 假 `<img>`：happy-dom 不会为 blob URL 派发 load，必须用假元素。 */
class FakeImageElement extends EventTarget {
  src = '';
  complete = false;
  naturalWidth = 1920;
  naturalHeight = 1080;

  markLoaded(): void {
    this.complete = true;
    this.dispatchEvent(new Event('load'));
  }

  removeAttribute(): void {
    /* no-op */
  }
}

/** 假 ImageBitmap。 */
function createFakeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

/** 让挂起的 promise 结算若干轮。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

/** 构造一个**必定返回帧**的取帧器（隔离合成器接线本身）。 */
function createStubSource(bitmap: ImageBitmap | null): PreviewFrameSource {
  const listeners = new Set<() => void>();
  const elementListeners = new Set<(assetId: string) => void>();
  return {
    ensureAsset: async (): Promise<boolean> => true,
    getFrame: (): ImageBitmap | null => bitmap,
    prime: async (): Promise<void> => undefined,
    setPlaying: (): void => undefined,
    setPlaybackRate: (): void => undefined,
    setAssetSpeed: (): void => undefined,
    getElement: (): HTMLMediaElement | null => null,
    unmute: (): void => undefined,
    onElementReady: (listener: (assetId: string) => void): (() => void) => {
      elementListeners.add(listener);
      return () => elementListeners.delete(listener);
    },
    onFrameReady: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get assetCount(): number {
      return 0;
    },
    getAssetIds: (): string[] => [],
    get readyCount(): number {
      return 0;
    },
    dispose: (): void => listeners.clear(),
  };
}

describe('预览取帧 → 合成器 接线（端到端）', () => {
  let doc: ProjectDoc;

  beforeEach(() => {
    doc = deserialize(readFixtureJson('full.clipcut.json')).doc;
  });

  it('传入 getFrame 时视频图层真的被绘制（不传时就是全黑 —— 这就是原 bug）', () => {
    // 对照组：**不传** getFrame —— 复现原 bug，视频图层不绘制
    const withoutFrame = createMockContext();
    renderFrame(withoutFrame.ctx, doc, 2500);
    expect(withoutFrame.calls.filter((call) => call === 'drawImage').length).toBe(0);

    // 实验组：传入 getFrame —— 画面必须有内容
    const source = createStubSource(createFakeBitmap(1920, 1080));
    try {
      const withFrame = createMockContext();
      renderFrame(withFrame.ctx, doc, 2500, { getFrame: source.getFrame });
      expect(withFrame.calls.filter((call) => call === 'drawImage').length).toBeGreaterThan(0);
    } finally {
      source.dispose();
    }
  });

  it('真实的 previewFrameSource 接上合成器后，画面从黑屏变为有内容', async () => {
    const assets = Object.values(doc.assets).filter((asset) => asset.type === 'video');
    expect(assets.length).toBeGreaterThan(0);

    let urlSeq = 0;
    const pendingCaptures: Array<() => void> = [];
    const poolElements = new Map<string, HTMLVideoElement>();

    const source = createPreviewFrameSource({
      readAssetBlob: async (): Promise<Blob | null> => new Blob(['x']),
      createObjectURL: (): string => `blob:e2e/${(urlSeq += 1)}`,
      revokeObjectURL: (): void => undefined,
      captureFrame: (): Promise<ImageBitmap> =>
        new Promise<ImageBitmap>((resolve) => {
          pendingCaptures.push(() => resolve(createFakeBitmap(1920, 1080)));
        }),
      createImageElement: (): HTMLImageElement => {
        const element = new FakeImageElement();
        queueMicrotask(() => element.markLoaded());
        return element as unknown as HTMLImageElement;
      },
      createPool: () => ({
        acquire: (assetId: string): HTMLVideoElement => {
          const existing = poolElements.get(assetId);
          if (existing) return existing;
          const element = new FakeVideoElement() as unknown as HTMLVideoElement;
          poolElements.set(assetId, element);
          return element;
        },
        sync: async (): Promise<void> => undefined,
        playAll: async (): Promise<void> => undefined,
        pauseAll: (): void => undefined,
        setMuted: (muted: boolean, assetId?: string): void => {
          if (assetId === undefined) {
            for (const video of poolElements.values()) video.muted = muted;
            return;
          }
          const video = poolElements.get(assetId);
          if (video) video.muted = muted;
        },
        dispose: (): void => poolElements.clear(),
        get size(): number {
          return poolElements.size;
        },
        get mutedCount(): number {
          let count = 0;
          for (const video of poolElements.values()) if (video.muted) count += 1;
          return count;
        },
      }),
    });

    try {
      // 登记全部素材（等价于 PreviewCanvas 的 ensureAsset 副作用）
      const allAssets = Object.values(doc.assets);
      await Promise.all(allAssets.map((asset: Asset) => source.ensureAsset(asset)));
      // 视频与图片素材都应就绪
      expect(source.readyCount).toBe(allAssets.length);
      expect(source.readyCount).toBeGreaterThanOrEqual(assets.length);

      // 首帧：元素刚就绪、还没有帧 → 只清屏
      const firstPass = createMockContext();
      renderFrame(firstPass.ctx, doc, 2500, { getFrame: source.getFrame });
      expect(firstPass.calls.filter((call) => call === 'drawImage').length).toBe(0);

      // 放行所有挂起的抓帧
      await flush();
      const queued = pendingCaptures.splice(0, pendingCaptures.length);
      for (const resolve of queued) resolve();
      await flush();

      // 再渲染一帧：视频图层必须出现
      const secondPass = createMockContext();
      renderFrame(secondPass.ctx, doc, 2500, { getFrame: source.getFrame });
      expect(secondPass.calls.filter((call) => call === 'drawImage').length).toBeGreaterThan(0);
    } finally {
      source.dispose();
    }
  });

  it('导��路径与预览路径共用同一个 renderFrame，互不影响', () => {
    const bitmap = createFakeBitmap(1920, 1080);
    const source = createStubSource(bitmap);
    try {
      // 预览：opts 里带 getFrame
      const preview = createMockContext();
      renderFrame(preview.ctx, doc, 2500, { getFrame: source.getFrame });

      // 导出：同样只传 getFrame，签名与行为完全一致
      const exported = createMockContext();
      renderFrame(exported.ctx, doc, 2500, { getFrame: source.getFrame });

      expect(exported.calls).toEqual(preview.calls);
    } finally {
      source.dispose();
    }
  });

  it('getFrame 返回 null 时合成器安全降级（只清屏，不抛异常）', () => {
    const source = createStubSource(null);
    try {
      const { calls, ctx } = createMockContext();
      expect(() => renderFrame(ctx, doc, 2500, { getFrame: source.getFrame })).not.toThrow();
      expect(calls).toContain('fillRect');
      expect(calls.filter((call) => call === 'drawImage').length).toBe(0);
    } finally {
      source.dispose();
    }
  });

  it('字幕等非视频图层不受 getFrame 影响，始终绘制', () => {
    const source = createStubSource(createFakeBitmap(1920, 1080));
    try {
      const withFrame = createMockContext();
      renderFrame(withFrame.ctx, doc, 1500, { getFrame: source.getFrame });
      const withoutFrame = createMockContext();
      renderFrame(withoutFrame.ctx, doc, 1500);

      // 字幕与文字轨的绘制次数应完全一致（只有 drawImage 会因 getFrame 而有差异）
      const textWith = withFrame.calls.filter((call) => call.startsWith('fillText:'));
      const textWithout = withoutFrame.calls.filter((call) => call.startsWith('fillText:'));
      expect(textWith.length).toBeGreaterThan(0);
      expect(textWith).toEqual(textWithout);
    } finally {
      source.dispose();
    }
  });
});