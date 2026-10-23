/**
 * 变速保音高 worklet 运行时文件守门。
 *
 * ## 为什么需要这个测试
 *
 * `AudioEngine.workletModuleUrl` 默认指向 `/worklets/pitchPreserveStretchProcessor.js`，
 * 而仓库里过去**只有 TypeScript 源码**（`src/services/media/worklets/*.ts`），
 * **没有**这个运行时文件 —— `audioWorklet.addModule()` 必然 404，
 * `loadWorklet()` 于是每次都走降级分支（音高随速度变化）。
 *
 * 而且 `public/` 下的文件不在 TypeScript 的类型检查范围内：写错一个字符、
 * 删掉文件，都不会有任何编译期信号。这里把「文件存在 + 处理器名一致」钉成断言。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AudioEngine, PITCH_PRESERVE_WORKLET_NAME } from '../audioEngine.js';

/** worklet 运行时文件相对包根的路径。 */
const WORKLET_RELATIVE = path.join('public', 'worklets', 'pitchPreserveStretchProcessor.js');

/**
 * 定位 worklet 运行时文件。
 *
 * 不能用 `import.meta.url`：happy-dom 环境下它是 `http://localhost/...`，
 * `fileURLToPath` 会直接抛「URL must be of scheme file」。
 * 改为从 `process.cwd()` 逐级向上找 —— 无论从包根还是仓库根启动 vitest 都成立。
 */
function locateWorklet(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, WORKLET_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), WORKLET_RELATIVE);
}

/** worklet 运行时文件的绝对路径。 */
const WORKLET_PATH = locateWorklet();

describe('变速保音高 worklet 运行时文件', () => {
  it('public/worklets/pitchPreserveStretchProcessor.js 确实存在', () => {
    expect(() => readFileSync(WORKLET_PATH, 'utf-8')).not.toThrow();
  });

  it('AudioEngine 默认的 workletModuleUrl 指向该文件', () => {
    const engine = new AudioEngine();

    expect(engine.workletModuleUrl).toBe('/worklets/pitchPreserveStretchProcessor.js');
  });

  it('注册名与 PITCH_PRESERVE_WORKLET_NAME 一致（否则 AudioWorkletNode 会抛）', () => {
    const source = readFileSync(WORKLET_PATH, 'utf-8');

    expect(source).toContain(`registerProcessor('${PITCH_PRESERVE_WORKLET_NAME}'`);
  });

  it('是纯 JS：不含 TS 类型语法（worklet 全局作用域不做转译）', () => {
    const source = readFileSync(WORKLET_PATH, 'utf-8');

    // `interface` / `: number` 标注 / `implements` 出现在运行时文件里都会直接语法报错
    expect(source).not.toMatch(/^\s*interface\s+\w+/m);
    expect(source).not.toMatch(/\bimplements\b/);
    expect(source).not.toMatch(/^\s*(private|public|readonly)\s+/m);
    // 也不能 import 任何模块（worklet 全局作用域没有模块系统）
    expect(source).not.toMatch(/^\s*import\s+/m);
  });

  it('不引用 window / document（worklet 全局作用域没有它们）', () => {
    const source = readFileSync(WORKLET_PATH, 'utf-8');

    expect(source).not.toMatch(/\bwindow\./);
    expect(source).not.toMatch(/\bdocument\./);
  });
});