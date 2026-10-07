# Tech Stack

版本精确锁定（不使用 `^` 或 `~`）。升级版本时同步更新本文件。标 ⚠️ 的是与最初清单不同的地方，原因见对应说明。

## 仓库与全局基线

| 用途               | 选型                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| 包管理、workspaces | Bun 1.4.2                                                                                   |
| 语言               | TypeScript 6.0.3，Bun 类型 @types/bun 1.4.2                                                 |
| 测试               | ⚠️ 按运行时选择（ADR-0004）：Bun 代码用 `bun:test`；Electron main 和渲染进程用 Vitest 5.0.1 |

## Agent

| 用途                                        | 选型                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| 模型调用                                    | @earendil-works/pi-ai 0.99.2                                                |
| HTML → Markdown                             | turndown 7.2.4 + @joplin/turndown-plugin-gfm 1.0.68                         |
| HTML 内容过滤                               | @mixmark-io/domino 2.2.0（复用 turndown 的 DOM，在 GFM 转换前删除隐藏子树） |
| HTML 转换类型                               | @types/turndown 5.0.6（仅 devDependency）                                   |
| 公网 HTTP 请求                              | undici 8.11.2                                                               |
| Agent loop 和 harness                       | @earendil-works/pi-agent-core 0.99.2                                        |
| 文件外部修改与工具卡的 unified / split diff | diff 8.0.4                                                                  |
| glob 的 gitignore 匹配                      | ignore 7.0.8                                                                |
| grep 的内置二进制                           | @vscode/ripgrep 1.18.0                                                      |
| MCP                                         | @earendil-works/pi-mcp 0.99.2                                               |
| 支持的协议                                  | Chat Completions、Responses、Anthropic Messages                             |

## 服务端

| 用途      | 选型                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 运行时    | Bun 1.4.2                                                                                                                                                          |
| HTTP      | ⚠️ Hono 4.13.12（原清单为 4.13.9）                                                                                                                                 |
| WebSocket | ⚠️ `@hono/bun` 1.0.0（peer 依赖 `hono >=4.13.9`）。从它引入 `upgradeWebSocket` 和 `websocket`；不要用 `hono/bun` 子路径，它从 4.13.10 起已标记弃用，Hono v5 会移除 |
| 输入校验  | ⚠️ typebox 跟随 pi 的版本，目前是 1.3.27，不用 1.3.34。保证依赖树里只有一份，否则 schema 类型对不上                                                                |
| 存储      | sqlite（`bun:sqlite`）；headless 模式用 JSONL（ADR-0003）                                                                                                          |

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
| 组件原语 | shadcn + ai-elements                                                                                                                            |
| 类名工具 | class-variance-authority 0.7.1 处理变体；clsx 2.1.1 加 tailwind-merge 3.7.0 组成 `cn()`；用 `extendTailwindMerge` 让 `text-ui-*` 也参与冲突合并 |
| 图标     | lucide-react 1.48.0                                                                                                                             |
| Markdown | micromark 解析 + 自研的 mdast→React 渲染 + shiki/katex                                                                                          |
| 图表     | mermaid                                                                                                                                         |
| 状态管理 | Zustand 5.0.12 + Immer 10.2.0                                                                                                                   |
| 国际化   | 自研 `@rukie/i18n`：运行时无关的 zh / en locale 解析、通用文案、字典组合与插值、时长格式化；frontend 读取配置并选择 locale（ADR-0008）          |

## coding-agent 终端渲染器（ADR-0005）

Headless CLI、TUI 与 renderer 的依赖统一归 `packages/coding-agent/package.json`，版本保持不变。自研渲染器位于 `packages/coding-agent/src/ink/`，Yoga 位于 `src/ink/yoga/`。

| 用途                                        | 选型                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React                                       | react 19.3.0                                                                                                                                                                                                                                                                                                                                                |
| 宿主树协调                                  | react-reconciler 0.34.0                                                                                                                                                                                                                                                                                                                                     |
| 类型                                        | @types/react 19.3.0、@types/react-reconciler 0.33.1（目前发布的类型版本，覆盖 0.34.0 使用的接口）                                                                                                                                                                                                                                                           |
| 假终端（仅 devDependency）                  | @xterm/headless 6.0.0                                                                                                                                                                                                                                                                                                                                       |
| 假终端 Unicode（TUI app，仅 devDependency） | @xterm/addon-unicode11 0.9.0（月相 emoji 按 2 列解释）                                                                                                                                                                                                                                                                                                      |
| 工具代码语法高亮                            | highlight.js 11.12.0（直接将 lexer 输出映射到主题 token，无 ANSI 桥接依赖）                                                                                                                                                                                                                                                                                 |
| TUI Markdown                                | mdast-util-from-markdown 2.1.0 + mdast-util-gfm 3.1.0 + micromark-extension-gfm 3.0.0 + mdast-util-math 3.0.0 + micromark-extension-math 3.1.0（CommonMark、GFM 与 TeX 分词，自研终端 React 渲染）；lovely-mermaid 0.3.3（Unicode 图）；Pi MIT LaTeX Unicode renderer，源提交 fa0e1f48ac，经固定 dsh-TUI 参考 3c89ea516e4f7d2777efe979200016528722a0b4 引入 |
| 布局                                        | dsh-TUI 的纯 TS Yoga，commit `646740f12c34546d6c195f5b7031be0dc67421a5`，拷入包内，不对外导出                                                                                                                                                                                                                                                               |

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
