/**
 * 文件类型白名单测试（FR-006 的唯一来源）。
 */

import { describe, expect, it } from 'vitest';
import {
  detectAssetType,
  getExtension,
  isSupportedExtension,
  isSupportedMime,
  unsupportedReason,
} from '../fileTypes.js';

describe('platform/fileTypes', () => {
  it('按扩展名分类', () => {
    expect(detectAssetType('a.mp4')).toBe('video');
    expect(detectAssetType('a.webm')).toBe('video');
    expect(detectAssetType('a.mov')).toBe('video');
    expect(detectAssetType('a.mp3')).toBe('audio');
    expect(detectAssetType('a.wav')).toBe('audio');
    expect(detectAssetType('a.ogg')).toBe('audio');
    expect(detectAssetType('a.m4a')).toBe('audio');
    expect(detectAssetType('a.jpg')).toBe('image');
    expect(detectAssetType('a.png')).toBe('image');
    expect(detectAssetType('a.webp')).toBe('image');
    expect(detectAssetType('a.gif')).toBe('image');
  });

  it('按 MIME 优先分类', () => {
    expect(detectAssetType('a.bin', 'video/mp4')).toBe('video');
    expect(detectAssetType('a.bin', 'image/png')).toBe('image');
  });

  it('不支持的格式返回 null', () => {
    expect(detectAssetType('a.exe')).toBeNull();
    expect(detectAssetType('a')).toBeNull();
  });

  it('扩展名与 MIME 白名单判断', () => {
    expect(isSupportedExtension('a.mp4')).toBe(true);
    expect(isSupportedExtension('a.exe')).toBe(false);
    expect(isSupportedMime('video/mp4')).toBe(true);
    expect(isSupportedMime('application/x-msdownload')).toBe(false);
    expect(getExtension('a.b.MP4')).toBe('mp4');
  });

  it('给出用户可读的失败原因', () => {
    expect(unsupportedReason('a.exe')).toContain('.exe');
    expect(unsupportedReason('a')).toContain('缺少扩展名');
  });
});
