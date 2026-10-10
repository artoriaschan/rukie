# Tech Stack

版本精确锁定（不使用 `^` 或 `~`）。升级版本时同步更新本文件。标 ⚠️ 的是与最初清单不同的地方，原因见对应说明。

## 仓库与全局基线

| 用途               | 选型                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| 包管理、workspaces | Bun 1.4.2                                                                                   |
| 语言               | TypeScript 6.0.3，Bun 类型 @types/bun 1.4.2                                                 |
| 测试               | ⚠️ 按运行时选择（ADR-0004）：Bun 代码用 `bun:test`；Electron main 和渲染进程用 Vitest 5.0.3 |

## Agent

| 用途                                         | 选型                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| 模型调用                                     | @earendil-works/pi-ai 1.0.4                                                          |
| HTML → Markdown                              | turndown 7.2.4 + @joplin/turndown-plugin-gfm 1.0.68                                  |
| HTML 内容过滤                                | @mixmark-io/domino 2.2.0（复用 turndown 的 DOM，在 GFM 转换前删除隐藏子树）          |
| HTML 转换类型                                | @types/turndown 5.0.6（仅 devDependency）                                            |
| 公网 HTTP 请求                               | undici 8.11.2                                                                        |
| Harness、Conversation、Submission 和恢复任务 | @earendil-works/pi-durable 1.0.4（[ADR-0024](adr/0024-adopt-pi-durable-harness.md)） |
| 原生运行与持久化任务上下文                   | @earendil-works/chord 1.0.4                                                          |
| pi 遥测解析依赖                              | @earendil-works/pi-telemetry 1.0.4（通过根 overrides 精确对齐）                      |
| 文件外部修改与工具卡的 unified / split diff  | diff 8.0.4                                                                           |
| glob 的 gitignore 匹配                       | ignore 7.0.8                                                                         |
| grep 的内置二进制                            | @vscode/ripgrep 1.18.0                                                               |
| MCP                                          | @earendil-works/pi-mcp 1.0.4                                                         |
| 支持的协议                                   | Chat Completions、Responses、Anthropic Messages                                      |

## 服务端

| 用途      | 选型                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 运行时    | Bun 1.4.2                                                                                                                                                          |
| HTTP      | ⚠️ Hono 4.13.12（原清单为 4.13.9）                                                                                                                                 |
| WebSocket | ⚠️ `@hono/bun` 1.0.0（peer 依赖 `hono >=4.13.9`）。从它引入 `upgradeWebSocket` 和 `websocket`；不要用 `hono/bun` 子路径，它从 4.13.10 起已标记弃用，Hono v5 会移除 |
| 输入校验  | ⚠️ typebox 跟随 pi 的版本，目前是 1.3.27，不用 1.3.34。保证依赖树里只有一份，否则 schema 类型对不上                                                                |
| 业务编排  | Effect 4.0.2，仅 server 内使用 ManagedRuntime、Layer 与 FiberMap（[ADR-0030](adr/0030-desktop-server-hono-and-effect.md)）                                         |
| 存储      | 原生 durable JSONL（启用 fsync）；`bun:sqlite` 独占事务持有宿主 lease（[ADR-0024](adr/0024-adopt-pi-durable-harness.md)）                                          |

Pi 的直接依赖和解析到的支撑包统一为 1.0.4，TypeBox 为 1.3.27；根 `overrides` 约束上游宽版本声明，`bun.lock` 保存实际解析。当前依赖树不包含 pi-agent-core 或 pi-coding-agent。JSONL 保存 Session 数据；SQLite 事务仅持有宿主写者 lease，不是已实现的桌面数据后端。

## 桌面端

| 用途                 | 选型                     |
| -------------------- | ------------------------ |
| 桌面壳               | Electron 41.0.3          |
| main 和 preload 构建 | tsdown 0.22.2            |
| 渲染进程构建         | Vite 8.3.1               |
| 打包                 | electron-builder 26.15.3 |
| 加固                 | @electron/fuses 2.0.0    |
| 自动更新             | electron-updater 6.8.9   |
| 原生依赖             | koffi 3.3.1              |

## 界面

| 用途     | 选型                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架     | React 19.3.0 + react-dom 19.3.0                                                                                                                 |
| 样式     | Tailwind CSS 4.3.3                                                                                                                              |
| 组件原语 | beUI 优先 + shadcn 补位：beUI 提供组件、原语、默认风格、动效与 Agent 执行反馈，beUI 未覆盖的角色用 shadcn；均经 shadcn CLI 安装                 |
| 类名工具 | class-variance-authority 0.7.1 处理变体；clsx 2.1.1 加 tailwind-merge 3.7.0 组成 `cn()`；用 `extendTailwindMerge` 让 `text-ui-*` 也参与冲突合并 |
| 图标     | lucide-react 1.55.0                                                                                                                             |
| Markdown | micromark 解析 + 自研的 mdast→React 渲染 + shiki/katex                                                                                          |
| 图表     | mermaid                                                                                                                                         |
| 状态管理 | Zustand 5.0.12 + Immer 10.2.0                                                                                                                   |
| 国际化   | 自研 `@rukie/i18n`：运行时无关的 zh / en locale 解析、通用文案、字典组合与插值、时长格式化；frontend 读取配置并选择 locale（ADR-0008）          |

## coding-agent 终端渲染器（ADR-0013）

Headless CLI、TUI 与 renderer 的依赖统一归 `packages/coding-agent/package.json`。终端 runtime 固定采用 dsh-TUI 来源，位于 `packages/coding-agent/src/ink/`，Yoga 位于 `src/ink/native-ts/yoga-layout/`；产品 design system 保留在 `src/ink/design-system/`。

| 用途                                                | 选型                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React                                               | react 19.3.0                                                                                                                                                                                                                                                                                                                                                |
| 宿主树协调                                          | react-reconciler 0.34.0                                                                                                                                                                                                                                                                                                                                     |
| 类型                                                | @types/react 19.3.0、@types/react-reconciler 0.33.1（目前发布的类型版本，覆盖 0.34.0 使用的接口）                                                                                                                                                                                                                                                           |
| 假终端（仅 devDependency）                          | @xterm/headless 6.0.0                                                                                                                                                                                                                                                                                                                                       |
| 假终端 Unicode（renderer 与 TUI，仅 devDependency） | @xterm/addon-unicode-graphemes 0.4.0（Unicode15 grapheme，ZWJ/月相 emoji 与 wide tail cells）                                                                                                                                                                                                                                                               |
| 工具代码语法高亮                                    | highlight.js 11.12.0（直接将 lexer 输出映射到主题 token，无 ANSI 桥接依赖）                                                                                                                                                                                                                                                                                 |
| TUI Markdown                                        | mdast-util-from-markdown 2.1.0 + mdast-util-gfm 3.1.0 + micromark-extension-gfm 3.0.0 + mdast-util-math 3.0.0 + micromark-extension-math 3.1.0（CommonMark、GFM 与 TeX 分词，自研终端 React 渲染）；lovely-mermaid 0.3.3（Unicode 图）；Pi MIT LaTeX Unicode renderer，源提交 fa0e1f48ac，经固定 dsh-TUI 参考 3c89ea516e4f7d2777efe979200016528722a0b4 引入 |
| 布局                                                | dsh-TUI 固定来源 `3c89ea516e4f7d2777efe979200016528722a0b4` 的纯 TS Yoga，拷入 ink 内部，不对外导出                                                                                                                                                                                                                                                         |

## 代码质量

| 用途                 | 选型                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| Lint 和格式化        | Oxlint 1.86.0 + Oxfmt 0.71.0                                            |
| 提交前格式化         | lint-staged 17.5.1                                                      |
| Git hooks            | husky 9.1.7                                                             |
| 提交信息规范         | @commitlint/cli 21.2.3 + @commitlint/config-conventional 21.2.3         |
| 死代码和未使用的依赖 | knip 6.37.0                                                             |
| 文档 Markdown 解析   | mdast-util-from-markdown 2.1.0（根 devDependency，复用 TUI 已锁定版本） |
| 类型检查             | `tsc -b`                                                                |

## dsh ink runtime

终端管线采用 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 的 ink 与纯 TypeScript Yoga；来源及最小本地改动见 [ink README](../packages/coding-agent/src/ink/README.md)。以下为实际安装的直接依赖，版本全部精确固定；sharp 提供真实图片解码/缩放，sixel 通过 Bun worker 编码。

| 依赖                       | 版本     |
| -------------------------- | -------- |
| `react`                    | `19.3.0` |
| `react-reconciler`         | `0.34.0` |
| `@alcalzone/ansi-tokenize` | `0.3.1`  |
| `auto-bind`                | `5.0.1`  |
| `bidi-js`                  | `1.1.0`  |
| `chalk`                    | `6.0.1`  |
| `cli-boxes`                | `4.0.1`  |
| `code-excerpt`             | `4.0.0`  |
| `emoji-regex`              | `11.0.0` |
| `get-east-asian-width`     | `1.7.0`  |
| `indent-string`            | `5.0.0`  |
| `lodash-es`                | `4.18.1` |
| `semver`                   | `7.8.5`  |
| `sharp`                    | `0.35.4` |
| `signal-exit`              | `4.1.0`  |
| `sixel`                    | `0.16.0` |
| `stack-utils`              | `2.0.6`  |
| `strip-ansi`               | `7.2.0`  |
| `supports-hyperlinks`      | `4.6.0`  |
| `type-fest`                | `5.10.0` |
| `wrap-ansi`                | `10.0.2` |

类型依赖：`@types/lodash-es` 4.17.12、`@types/semver` 7.8.0、`@types/stack-utils` 2.0.3。测试使用已有 `@xterm/headless` 6.0.0；原生渲染组合计时测试使用仅开发依赖 `@sinonjs/fake-timers` 15.4.0（自带类型），以零时推进完成 xterm I/O 时保持虚拟截止时间。

## npm CLI 分发工具链

本地构建固定使用 Bun 1.4.2（[.bun-version](../.bun-version)），只生成 macOS arm64 安装包。主包 launcher 要求 Node.js >=24.15.0，并通过 POSIX execve 启动内置 Bun 的平台执行文件；npm 用于 pack／install，实际使用版本记录在构建 metadata。原生 sidecar 使用锁文件中的 @vscode/ripgrep-darwin-arm64 1.18.0、@img/sharp-darwin-arm64 0.35.4 与 @img/sharp-libvips-darwin-arm64 1.3.3；构建和本地安装验收见[分发教程](release-building.md)。发布工作流的 npm/OIDC 工具版本由其配置与发布教程维护。发布脚本直接使用 root devDependency semver 7.8.5 与 @types/semver 7.8.0，校验 npm OIDC 版本范围及通道递增。

Release PR 使用精确锁定的 `release-please@17.3.0`，由 Bun 执行官方 Manifest/Strategy/Changelog API；GitHub Actions 的不可变 commit 和工具版本见[版本准备 workflow](../.github/workflows/release-prepare.yml)。当前 commit CI 门槛、GitHub App 配置和 beta/稳定切换见[版本准备](release-preparation.md)。

CI 与发布 workflows 的官方 Actions 使用 Node.js 24 runtime：checkout 7.0.1、setup-node 7.1.0、upload-artifact 7.0.2、download-artifact 8.0.2，均固定到完整 commit SHA。该 runtime 与 setup-node 为源码和安装包验收配置的 Node.js 版本分别由 Actions 声明和 workflow 输入决定。

## 桌面测试与骨架的已安装依赖

桌面三个 workspace 的协议与检查骨架已接入。测试工具为根 devDependency：vitest 5.0.3、@vitest/browser-playwright 5.0.3、playwright 1.64.0、vitest-browser-react 2.3.0、@vitejs/plugin-react 6.1.2、vite 8.3.1 和 @types/node 24.19.2。ui 精确声明 react/react-dom 19.3.0 的 peerDependencies，类型为 @types/react 19.3.0。server 与 ui 的 schema 测试复用 typebox 1.3.27。

上述桌面壳、服务框架和其余 GUI 选型表包含后续实现的目标依赖；已安装 Electron 41.0.3、Hono 和 Effect；其他目标依赖按相应工单接入。以各包 manifest 和 lockfile 为已安装事实，测试准备和运行边界见[测试策略](testing.md#桌面测试入口)。

### UI registry runtime

`packages/ui` installs complete beUI source and shadcn dropdown-menu through shadcn CLI 4.21.4. Runtime dependencies are motion 14.1.0, @floating-ui/dom 1.8.0, shiki 4.5.0, radix-ui 1.7.0, tw-animate-css 1.4.0, clsx 2.1.1, tailwind-merge 3.7.0, lucide-react 1.55.0 and Tailwind CSS 4.3.3. The Vite Tailwind plugin is 4.3.3; React DOM declarations are @types/react-dom 19.2.3. Code highlighting imports five language modules and GitHub Light/Dark themes through shiki/core.
