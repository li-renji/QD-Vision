import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 冒烟 + 播放链路测试配置。
 *
 * ## 隔离构建目录与端口（关键）
 *
 * webServer 先把应用构建到**独立目录**、再 preview 该目录，
 * **刻意不复用开发用的 `dist/`**。
 *
 * 原因：`vite build` 会先清空 `outDir` 再重写。若与开发时的 `pnpm build`
 * 共用 `dist/`，那么本地一边 build、一边跑 e2e 时，正在跑的用例会读到
 * **半截**的 `index.html`（标题变空字符串）或资源 404，表现为**随机失败、
 * 每次失败的用例都不同**的 flaky。
 *
 * - `--outDir`：Vite 的 CLI 参数优先级高于 `vite.config.ts`，无需环境变量
 * - `reuseExistingServer: false`：强制用本次构建产物，杜绝复用旧服务
 *
 * ## 端口与目录怎么隔离
 *
 * 只把 e2e 与开发构建分开还不够：**两个并发的 e2e 运行**会互相踩踏——
 * 它们会同时 ① 构建同一个 outDir（`vite build` 先清空 outDir）；
 * ② 抢占同一个固定端口。实测并发时 6~12 条用例随机失败，且失败文件每次不同。
 *
 * 因此这里让**端口与构建目录都按「运行标识」隔离**：
 * - 运行标识优先取环境变量 `E2E_RUN`，否则取 `process.pid`；
 * - 端口：`4183 + (hash % 1000)`；构建目录：系统临时目录下的
 *   `qd-shijie-e2e-<run>`，**不放进仓库**，既不污染工作区也不需要 .gitignore。
 *
 * ### ⚠️ 为什么不能直接用 `process.pid`
 *
 * Playwright 会在**每个 worker 进程里重新加载本配置文件**。若直接用
 * `process.pid`，主进程算出的端口（用于拉起 webServer）与各 worker 算出的
 * `baseURL` 会**各不相同** —— 表现为每条用例都
 * `ERR_CONNECTION_REFUSED`，且每次端口都变。
 *
 * 所以这里必须用**跨进程稳定**的取值。默认固定为 `'default'`（所有进程一致）；
 * 需要并发跑时由调用方显式注入 `E2E_RUN`，该环境变量被子进程继承、保持一致。
 * 并行跑时显式指定即可：
 * ```
 * npx playwright test                # 默认运行（端口/目录固定）
 * E2E_RUN=a npx playwright test     # 端口/目录 A，可与 B 并行
 * E2E_RUN=b npx playwright test
 * ```
 */
const E2E_RUN = process.env['E2E_RUN'] ?? 'default';

/** 本次运行的端口（跨进程稳定）。 */
const E2E_PORT = 4183 + (hashString(E2E_RUN) % 1000);

/** 本次运行的独立构建目录（系统临时目录，不进仓库）。 */
const E2E_OUT_DIR = join(tmpdir(), `qd-shijie-e2e-${hashString(E2E_RUN)}`);

/** 稳定的字符串散列（FNV-1a 32 位），避免不同运行标识撞端口/目录。 */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export default defineConfig({
  testDir: './e2e',
  /**
   * 忽略**临时排查脚本**。
   *
   * 约定：文件名以 `_` 或 `.` 开头 = 一次性排查脚本（跑完即删），
   * 与 .gitignore 的「点号开头 .mjs」规则、eslint 的同名忽略项是同一套约定。
   *
   * 为什么必须忽略：这类脚本常自带独立配置（如 `_chk.config.ts` 指向自己
   * 的 4399 端口），但默认 `testMatch` 会把 `e2e/` 下**任何** `*.spec.ts`
   * 都收进共享测试运行 —— 于是它在共享运行里必然失败（连不上自己的端口），
   * 把整条 e2e 门禁拖红。产品用例一律不以 `_` / `.` 开头。
   */
  testIgnore: /[\\/][_.][^\\/]*\.spec\.ts$/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'off',
    /**
     * 预览音频（WebAudio）需要这两个 Chromium 开关：
     *
     * - `--autoplay-policy=no-user-gesture-required`：`AudioContext` 默认在
     *   `suspended` 态，且 `resume()` 在没有用户手势时会被拒绝。
     *   headless 下没有真实手势，缺这个开关 `context.state` 永远停在
     *   `suspended`，音频链路的断言就全部失真。
     * - `--use-fake-device-for-media-stream`：headless 没有真实音频输出设备，
     *   `MediaRecorder` / `AudioContext` 会因找不到 sink 而不出数。
     */
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
    ...devices['Desktop Chrome'],
  },
  webServer: {
    // `--emptyOutDir`：outDir 在仓库之外（系统临时目录），
    // vite 默认拒绝清空项目根目录之外的目录，必须显式声明。
    //
    // `--strictPort`：**端口被占时必须直接失败，而不是静默顺延到下一个空闲端口**。
    // 默认行为下 vite 会自动换端口，而 Playwright 的 `baseURL` 仍指向原端口 ——
    // 于是测试连到的是「别人的服务」或直接 `ERR_CONNECTION_REFUSED`，
    // 表现为完全无法从错误信息定位的灵异失败。加上它，端口冲突会明确报错。
    command: `vite build --outDir "${E2E_OUT_DIR}" --emptyOutDir && vite preview --outDir "${E2E_OUT_DIR}" --port ${E2E_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
