# Tech Stack

版本精确锁定（不使用 `^` 或 `~`）。升级版本时同步更新本文件。标 ⚠️ 的是与最初清单不同的地方，原因见对应说明。

## 仓库与全局基线

| 用途               | 选型                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| 包管理、workspaces | Bun 1.4.2                                                                                   |
| 语言               | TypeScript 6.0.3，Bun 类型 @types/bun 1.4.2                                                 |
| 测试               | ⚠️ 按运行时选择（ADR-0004）：Bun 代码用 `bun:test`；Electron main 和渲染进程用 Vitest 5.0.1 |

## Agent

| 用途                   | 选型                                            |
| ---------------------- | ----------------------------------------------- |
| 模型调用               | @earendil-works/pi-ai 0.99.2                    |
| Agent loop 和 harness  | @earendil-works/pi-agent-core 0.99.2            |
| glob 的 gitignore 匹配 | ignore 7.0.8                                    |
| grep 的内置二进制      | @vscode/ripgrep 1.18.0                          |
| MCP                    | @earendil-works/pi-mcp 0.99.2                   |
| 支持的协议             | Chat Completions、Responses、Anthropic Messages |

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
| 国际化   | 自研                                                                                                                                            |

## 代码质量

| 用途                 | 选型                                                            |
| -------------------- | --------------------------------------------------------------- |
| Lint 和格式化        | Oxlint 1.86.0 + Oxfmt 0.71.0                                    |
| 提交前格式化         | lint-staged 17.5.1                                              |
| Git hooks            | husky 9.1.7                                                     |
| 提交信息规范         | @commitlint/cli 21.2.3 + @commitlint/config-conventional 21.2.3 |
| 死代码和未使用的依赖 | knip 6.37.0                                                     |
| 类型检查             | `tsc -b`                                                        |
