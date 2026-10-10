# 研究：Vitest 在 ui 与 desktop 的接入

回答 [工单 13](../issues/13-research-vitest-setup.md)。版本基线：Bun 1.4.2、Node.js 24.15.0（本机与 CI `setup-node` 同版本）、Vite 8.3.1、React 19.3.0、Electron 41.0.3、TypeScript 6.0.3。

来源分三类：npm registry 元数据（`npm view`，2026-10-10 查询）、npm 已发布 tarball 中的源码与类型声明、2026-10-10 在 macOS arm64 上的临时 workspace 实验（`/tmp/rukie-research-13-vitest`，已删除，标“实测”）。未标“实测”的结论来自阅读。实验未在 GitHub Actions 运行，也未启动真实 Electron 进程。

## 结论

1. `packages/ui` 只用 Vitest browser mode：provider 为 `@vitest/browser-playwright`，浏览器为 Playwright 自带的 Chromium headless shell，组件渲染用 `vitest-browser-react`。不引入 jsdom 或 happy-dom，保持“一种 DOM 测试环境”。实测：React 19.3.0 组件在 Chromium 中渲染、点击与断言通过，单文件约 1.5 s。
2. `packages/desktop` 的 main 与 preload 测试在 Vitest `environment: "node"` 下运行，`vi.mock("electron")` 替换 Electron API。必须由 Node 执行：`bun run` 调用 `vitest` 时按其 `#!/usr/bin/env node` shebang 走 Node 24.15.0（实测）；不得使用 `bun --bun`，否则测试实际跑在 Bun 上（实测 `process.versions.bun` 为 1.4.2），违背 ADR-0004。
3. 根目录新增 `bunfig.toml`，用 `[test] pathIgnorePatterns` 排除 `packages/ui/**` 与 `packages/desktop/**`。实测：未排除时 `bun test` 会收集并失败全部 Vitest 文件；排除后全量、`--parallel`、`--shard` 与显式路径都不再收集它们。CI 的 `bun run test --shard=N/4` 因此无需改动。
4. 新增根脚本 `test:desktop`（`vitest run`，根 `vitest.config.ts` 用 `projects` 聚合 ui 与 desktop），只接入 `check`，不接入 `check:dev`。CI 执行的是 `check:dev`，桌面端测试因此保持本地运行。
5. 现有 `check:test-policy` 已扫描 `packages/**/tests` 下的 `.ts/.tsx`，对 Vitest 文件同样有效（实测拒绝 `test.only`、`it.only`、`node:timers/promises` 固定延时与 timer resolver）。建议再加一条 runner 边界规则：ui/desktop 不得导入 `bun:test`，其他包不得导入 `vitest`。
6. 精确锁定：`vitest` 5.0.3、`@vitest/browser-playwright` 5.0.3、`playwright` 1.64.0、`vitest-browser-react` 2.3.0、`@vitejs/plugin-react` 6.1.2、`@types/node` 24.19.2。tech-stack 中的 Vitest 5.0.1 引入时改为 5.0.3（`@vitest/browser-playwright` 与 `vitest` 是精确 peer，两者必须同版本）。
7. 真实 Electron 端到端测试（Playwright `_electron`，官方标注 experimental）不进入 MVP；打包后的 `.app` 用手工冒烟验证。

## 1. ui：browser mode 还是 jsdom/happy-dom

| 方案                 | 优点                                                                                                             | 问题                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| browser mode（推荐） | 真实布局、焦点、键盘事件、CSS（Tailwind、`prefers-reduced-motion`）与 ResizeObserver；beUI 动效和 glass 表面可测 | 需要本地安装 Chromium（实测 Playwright 缓存约 206 MB，含 headless shell 与 ffmpeg）；启动成本高于 DOM 模拟 |
| happy-dom 20.14.6    | 快（实测单文件约 0.3 s），无浏览器依赖                                                                           | 无布局与真实焦点模型；AGENTS.md 要求的键盘、可见焦点与 Light/Dark 对比无法在此验证，最终仍需浏览器         |
| jsdom 30.1.2         | 生态最广                                                                                                         | 同样无布局；`engines.node` 为 `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`，锁死较新的 Node 补丁版本             |

依据：

- AGENTS.md 的 UI 组件规则要求验证键盘、可见焦点、可访问名称与动效降级，这些依赖真实浏览器的焦点与样式计算。DOM 模拟只能覆盖一部分，再加 browser mode 就是两条执行路径，违反“一种表示与一条执行路径”。
- ADR-0004 的决定正文已写明渲染进程测试需要 browser mode。
- 实测：`vitest-browser-react` 的 `render` 加 `page.getByRole(...).click()` 与 `expect.element(...).toBeVisible()` 在 Chromium 中通过；同一组件在 happy-dom 下用 `@testing-library/react` 16.3.3 + `@testing-library/user-event` 14.6.7 也通过（只用于对比，不推荐引入）。
- `vitest-browser-react` 2.3.0 的 peer 为 `react`/`react-dom` `^18 || ^19`、`vitest` `^4 || ^5`；它基于 Vitest 自带的 locator 与 `userEvent`（经 CDP 发出真实输入），不需要 Testing Library。

## 2. provider 与浏览器

- Vitest 5 把 provider 拆成独立包：`@vitest/browser-playwright`、`@vitest/browser-webdriverio`、`@vitest/browser-preview`。`vitest` 5.0.3 的 `peerDependencies` 把 `@vitest/browser-playwright` 精确约束到 `5.0.3`；`@vitest/browser-playwright` 5.0.3 依赖 `@vitest/browser` 5.0.3，peer `playwright: "*"`。`@vitest/browser` 不需要直接安装。
- 选 Playwright：通过 CDP 发真实输入，可并行；`preview` provider 用模拟事件，不适合验证键盘与焦点；WebdriverIO 需要额外的驱动管理。
- 浏览器：只用 `chromium` 一个 instance。Electron renderer 本身是 Chromium，测 Firefox/WebKit 不增加 MVP 的覆盖。注意版本不一致：`playwright` 1.64.0 的 `browsers.json` 中 Chromium 为 156.0.8078.4（revision 1248），Electron 41.0.3 内置 Chromium 146.0.7680.80（[releases.electronjs.org](https://releases.electronjs.org/releases.json)）。Playwright 每个版本只绑定一个浏览器 revision，无法对齐到 Electron 的 Chromium，因此 browser mode 验证的是“现代 Chromium 下的行为”，而不是 Electron renderer 本身。
- 本地准备：`bunx --no -- playwright install --only-shell chromium`（实测：只下载 headless shell 与 ffmpeg，到 `PLAYWRIGHT_BROWSERS_PATH` 或默认 `~/Library/Caches/ms-playwright`）。`headless: true` 时 Playwright 使用 headless shell。缺失浏览器时的行为未实测；预期 Playwright 启动失败使 `check` 非零退出，`test:desktop` 应在文档中给出安装命令。
- 兼容性：`vitest` 5.0.3 peer `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`，`@vitejs/plugin-react` 6.1.2 peer `vite: ^8.0.0`。实测：与 Vite 8.3.1（rolldown 1.2.13）一起安装，依赖树中只有一份 vite，browser 与 node 项目都正常运行。`vitest` 的 `engines.node` 为 `^22.12.0 || ^24.0.0 || >=26.0.0`，本机 Node 24.15.0 满足。

## 3. desktop：Electron main 的 Node 测试

- main 与 preload 运行在 Electron 内置的 Node（Electron 41.0.3 为 Node 24.14.0），单元测试用 Vitest 的 `node` 环境即可：`vi.mock("electron", () => ({ app: ..., BrowserWindow: vi.fn(...) }))`，断言构造参数（如 `sandbox`、`contextIsolation`）、IPC handler 注册与 sidecar 管理逻辑。实测：mock 生效，`BrowserWindow` 调用参数可断言，`process.versions.bun` 为 `undefined`。
- sidecar 管理（spawn、握手、崩溃重启一次，见 [02](../issues/02-connection-and-process-semantics.md)）在 Node 下测：spawn 一个假 sidecar 脚本或注入 spawn 函数。若 spawn 的是真实 Bun 编译产物，属于集成成本，按 docs/testing.md 记录理由与 focused timing。
- 运行时：`node_modules/.bin/vitest` 的 shebang 是 `#!/usr/bin/env node`。实测 `bun run test:desktop` 执行时 `process.versions.node` 为 24.15.0、无 `process.versions.bun`；`bun --bun run` 则改用 Bun 1.4.2，并使断言 `typeof process.versions.bun === "undefined"` 失败。脚本中禁止 `--bun`。由此，本地 `check` 新增前置条件：PATH 上有 Node 24.15.0（与 CI、npm 分发工具链要求一致）。
- Electron 二进制：测试 mock 掉 `electron` 后不需要下载 Electron。实测 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 时 `bun install` 正常，此时直接 import 真实 `electron` 会抛 “Electron failed to install correctly”。实测 `bun pm untrusted` 未把带 postinstall 的 `electron` 列为不受信任，即 Bun 默认会运行其 postinstall 下载二进制；打包需要它，单元测试不需要。
- 真实 Electron 端到端：Playwright 的 `_electron.launch()` 可驱动 Electron（`playwright-core` 1.64.0 类型声明注明 experimental support）。MVP 不引入：它要求先完成构建，且 macOS 上需要窗口会话，适合作为打包后的冒烟脚本单独评估。

## 4. 配置草案

根 `bunfig.toml`（新文件）：

```toml
[test]
# ADR-0004：ui 与 desktop 的测试由 Vitest 运行，bun test 不收集它们。
pathIgnorePatterns = ["packages/ui/**", "packages/desktop/**"]
```

根 `vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { projects: ["packages/ui", "packages/desktop"] },
});
```

`packages/ui/vitest.config.ts`：

```ts
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "ui",
    include: ["tests/**/*.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
```

`packages/desktop/vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "desktop", environment: "node", include: ["tests/**/*.test.ts"] },
});
```

实测：以上结构（根 `projects` 指向两个包的配置）一次运行两个项目均通过；`vitest run --project desktop` 可单独运行。测试文件沿用仓库的 `tests/` 镜像 `src/` 与 `*.test.ts(x)` 命名，不另造后缀。实验包未声明 `"type": "module"` 时 Vite 8 会警告配置文件加载方式；仓库各包已是 `"type": "module"`，不受影响。

TypeScript 与 Knip（阅读）：

- `packages/ui/tsconfig.json` 的 `types` 用 `["vitest/browser"]` 与 DOM lib，`packages/desktop` 用 `["node"]`（`@types/node` 24.19.2，匹配 Node 24），均不含 `bun`；在根 `tsconfig.json` 加 references。`vitest` 5.0.3 的 peer `@types/node` 为 `^22.0.0 || >=24.0.0`。
- knip 6.37.0 自带 `vitest` 与 `playwright` 插件，会把 `vitest.config.ts` 与测试文件识别为入口，无需在 `knip.json` 手写。

## 5. 接入 `check` 与 `check:test-policy`

根 `package.json` 脚本：

```json
{
  "test:desktop": "env -u NO_COLOR vitest run",
  "check": "bun run check:dev && bun run test && bun run test:desktop"
}
```

- 不改 `check:dev`：CI 的 build job 执行 `env -u NO_COLOR bun run check:dev`，测试分片执行 `bun run test --shard=N/4`。前者不含 `test:desktop`，后者被 `bunfig.toml` 排除，CI 不会运行或误收任何 Vitest 文件，符合 [03](../issues/03-mvp-scope.md#comments) 的“桌面端不接入 GitHub Actions”。
- 代价：`oxfmt`、`oxlint`、`tsc -b`、`knip` 与 `check:test-policy` 属于 `check:dev`，仍会在 CI 中检查 ui/desktop 的源码与测试文件（只是静态检查，不跑测试，不需要浏览器）。这符合“CI 不构建、不测试桌面端”的字面要求；若希望连静态检查也排除，需要另行决定。
- AGENTS.md 的 “Final verification” 规定普通 PR 由 CI 做全量验收。桌面端测试不在 CI，因此涉及 ui/desktop 的 PR 在交付证据中必须记录本地 `bun run test:desktop`（或 `check`）的结果。这需要写进 AGENTS.md 与 docs/testing.md。
- `check:test-policy`：现有检查器遍历 `packages/` 与 `scripts/` 下所有 `tests` 目录的 `.ts/.tsx`，按 TypeScript AST 判断，与 runner 无关。实测把一个导入 `vitest` 的样本交给 `checkTestSource`，四条违规全部报出。需要补充的规则：
  - runner 边界：`packages/ui`、`packages/desktop` 下导入 `bun:test` 报错；其他包导入 `vitest` 报错。这让 `pathIgnorePatterns` 与 ADR-0004 的划分由门禁保证，而不只靠约定。
  - 可选：拒绝 `vi.useFakeTimers()` 之后不在 `finally`/`afterEach` 中调用 `vi.useRealTimers()`。现有规则只覆盖 Bun 的时钟用法；是否机械化可留给实现工单判断。
  - 检查器的拒绝样本回归测试（`scripts/tests/`）同步加 Vitest 样本。

## 6. `bun test` 的收集规则与排除方式

- Bun 1.4.2 收集文件名含 `.test`、`_test_`、`.spec`、`_spec_` 的文件（`bun test` 无匹配时的提示原文）。仓库沿用 `*.test.ts(x)`，因此 ui/desktop 测试默认会被收集。
- 实测（无 `bunfig.toml`）：`bun test` 收集了 browser、happy-dom 与 desktop 三个 Vitest 文件，分别因 “vitest/browser can be imported only inside the Browser Mode”、DOM 缺失与 Electron 未安装失败。
- 实测（根 `bunfig.toml` 设 `pathIgnorePatterns`）：`bun test`、`bun test --parallel=2`、`bun test --shard=1/2` 与 `--shard=2/2` 都只收集 Bun 测试；`bun test packages/desktop/tests` 显示 0 个匹配并以非零退出。`--timings` 未单独实测，但它只对已收集的文件排序。
- 备选“换后缀”（如 `*.vitest.ts`）被否决：与仓库命名不一致，且 `check:test-policy` 的跨 spec 导入正则与 Knip/编辑器约定都基于 `.test`/`.spec`。按目录排除与 ADR-0004 的“按包选择 runner”一致。
- 影响：被排除的两个包内不能再有 `bun:test` 测试；第 5 节的 runner 边界规则保证这一点。

## 7. 版本表

| 包                           | 版本    | 角色                    | 依据                                                           |
| ---------------------------- | ------- | ----------------------- | -------------------------------------------------------------- |
| `vitest`                     | 5.0.3   | runner（ui、desktop）   | 2026-09-30 发布，`latest`；tech-stack 的 5.0.1 引入时更新      |
| `@vitest/browser-playwright` | 5.0.3   | browser provider        | `vitest` 5.0.3 peer 精确为 5.0.3；自带 `@vitest/browser` 5.0.3 |
| `playwright`                 | 1.64.0  | 浏览器驱动              | `latest`；Chromium 156.0.8078.4（revision 1248）               |
| `vitest-browser-react`       | 2.3.0   | React 渲染与 cleanup    | peer `react ^19`、`vitest ^5`                                  |
| `@vitejs/plugin-react`       | 6.1.2   | ui 测试与 renderer 构建 | peer `vite ^8.0.0`                                             |
| `@types/node`                | 24.19.2 | desktop 类型            | Node 24 线最新；满足 `vitest` peer                             |
| `vite`                       | 8.3.1   | 已锁定                  | 实测兼容；`latest` 为 8.3.4，不随本工单升级                    |
| `react` / `react-dom`        | 19.3.0  | 已锁定                  | 实测兼容                                                       |
| `electron`                   | 41.0.3  | 已锁定（测试中 mock）   | 41 线最新为 41.10.7，`latest` 为 44.7.0；升级不属本工单        |

不引入：`jsdom`、`happy-dom`、`@testing-library/*`、`@vitest/browser-preview`、`@vitest/browser-webdriverio`、`@vitest/coverage-*`。

## 未定

- Playwright 浏览器缓存的位置与安装时机：默认 `~/Library/Caches/ms-playwright`，还是在仓库脚本里固定 `PLAYWRIGHT_BROWSERS_PATH`；是否在 `postinstall` 自动安装（会让所有 `bun install`，包括 CI，多下载约 200 MB），还是只在 `test:desktop` 失败时提示。
- CI 的 `check:dev` 是否也要排除 ui/desktop 的静态检查（第 5 节）。
- 是否为打包后的 `.app` 引入 Playwright `_electron` 冒烟脚本。
