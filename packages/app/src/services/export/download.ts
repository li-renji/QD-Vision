/**
 * 触发浏览器下载 + 及时释放 ObjectURL（避免内存泄漏）。
 */

/**
 * 触发下载。
 *
 * @param fileName 文件名
 * @param blob 内容
 */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 延迟释放，避免部分浏览器下载尚未开始就失效。
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * 触发下载并返回 ObjectURL（调用方负责在合适时机 revoke）。
 */
export function createDownloadUrl(fileName: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return url;
}
