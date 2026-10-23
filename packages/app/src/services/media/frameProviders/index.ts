/**
 * 帧提供器工厂：按容器 / MIME 与能力自动选择 provider。
 */

import type { Asset } from '@clipcut/shared-types';
import { getBlobByKey } from '../../storage/blobRepo.js';
import { ElementFrameProvider } from './elementProvider.js';
import { Mp4DecoderFrameProvider } from './mp4DecoderProvider.js';
import type { FrameProvider } from './types.js';

/** 工厂配置。 */
export interface FrameProviderFactoryOptions {
  /** 素材 id → 素材对象（用于 `supports` 判断）。 */
  assets: Record<string, Asset>;
}

/** 已创建的 provider 实例。 */
const providers: FrameProvider[] = [];

/** 元素型 provider（共享实例）。 */
const elementProvider = new ElementFrameProvider();

/** mp4 型 provider（共享实例）。 */
const mp4Provider = new Mp4DecoderFrameProvider();

/**
 * 依据素材选择帧提供器。
 *
 * 优先 mp4-decoder（帧精确、硬解），否则降级 element。
 */
export function createFrameProvider(
  asset: Asset,
  options: FrameProviderFactoryOptions,
): FrameProvider {
  void options;

  if (mp4Provider.supports(asset)) {
    return mp4Provider;
  }
  return elementProvider;
}

/**
 * 为素材注册可取帧的源（从 IndexedDB 读取 Blob 并建立 URL）。
 *
 * @returns 是否注册成功
 */
export async function registerFrameSource(asset: Asset): Promise<boolean> {
  if (!asset.blobKey) return false;
  const blob = await getBlobByKey(asset.blobKey);
  if (!blob) return false;

  if (mp4Provider.supports(asset)) {
    mp4Provider.register(asset.id, blob);
  } else {
    const url = URL.createObjectURL(blob);
    elementProvider.register(asset.id, url);
  }
  return true;
}

/** 释放全部 provider。 */
export function disposeAllFrameProviders(): void {
  for (const provider of providers) provider.dispose();
  providers.length = 0;
  mp4Provider.dispose();
  elementProvider.dispose();
}
