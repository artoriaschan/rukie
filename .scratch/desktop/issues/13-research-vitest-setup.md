# 13: Vitest 在 ui 与 desktop 的接入

Type: research

Blocked by: None

Status: resolved

## Question

ADR-0004 规定 Electron main 与 renderer 用 Vitest。在 Bun workspace 中：`packages/ui` 用 Vitest browser mode（provider、浏览器、与 Vite 8.3.1 的版本兼容）还是 jsdom/happy-dom；`packages/desktop` main 进程的 Node 测试怎么跑；如何接入根 `bun run check` 与 `check:test-policy`（只在本地运行，不接入 GitHub Actions，且不能被 CI 现有的 Bun 测试分片误收）；需要锁定哪些精确版本？产出可执行的配置建议与版本表。

## Answer

完整调研：[research/vitest-setup.md](../research/vitest-setup.md)。在 macOS arm64、Bun 1.4.2、Node 24.15.0 上用临时 workspace 实测，临时文件与浏览器缓存已清理。

- ui：只用 Vitest browser mode，provider 为 `@vitest/browser-playwright`，只跑 Chromium headless shell 一个 instance，渲染用 `vitest-browser-react`；不引入 jsdom/happy-dom 与 Testing Library。实测 React 19.3.0 组件在 Chromium 中点击与断言通过，与 Vite 8.3.1 共存只有一份 vite。Playwright Chromium（156）与 Electron 41.0.3 内置 Chromium（146）版本不同，browser mode 不等于 Electron renderer 验证。
- desktop：main 与 preload 用 Vitest `environment: "node"`，`vi.mock("electron")` 替换 Electron API，不需要 Electron 二进制。`bun run` 按 vitest 的 node shebang 走 Node（实测）；禁止 `bun --bun`，否则测试跑在 Bun 上。真实 Electron 端到端（Playwright `_electron`，experimental）不进入 MVP。
- 防误收：根目录新增 `bunfig.toml`，`[test] pathIgnorePatterns = ["packages/ui/**", "packages/desktop/**"]`。实测未排除时 `bun test` 收集并失败全部 Vitest 文件；排除后全量、`--parallel`、`--shard` 均不再收集，CI 分片无需改动。保留 `*.test.ts(x)` 命名，不另造后缀。
- 接入：根 `vitest.config.ts` 用 `projects` 聚合两包；新增 `test:desktop`（`env -u NO_COLOR vitest run`）只加入 `check`，不加入 CI 运行的 `check:dev`。涉及 ui/desktop 的 PR 须在交付证据中记录本地运行结果，需同步 AGENTS.md 与 docs/testing.md。
- `check:test-policy`：现有 AST 规则对 Vitest 文件同样生效（实测）。新增 runner 边界规则：ui/desktop 禁止导入 `bun:test`，其他包禁止导入 `vitest`；回归样本同步补 Vitest 用例。
- 版本：`vitest` 5.0.3（tech-stack 的 5.0.1 引入时更新；provider 是精确 peer）、`@vitest/browser-playwright` 5.0.3、`playwright` 1.64.0、`vitest-browser-react` 2.3.0、`@vitejs/plugin-react` 6.1.2、`@types/node` 24.19.2。新增本地前置条件：Node 24.15.0 与 `playwright install --only-shell chromium`（约 206 MB）。
- 未定：浏览器缓存位置与安装时机（postinstall 会让 CI 也下载）；CI 的 `check:dev` 是否连 ui/desktop 的静态检查也排除；是否为打包后的 `.app` 加 `_electron` 冒烟脚本。
