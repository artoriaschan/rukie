# 19: packages/ui 的内部分层与边界

Type: grilling

Blocked by: 13, 15

Status: resolved

## Question

`packages/ui` 内如何分层：组件、Zustand store、wire client（[10](10-wire-protocol-messages.md#answer)）、host 接口（Electron preload 与浏览器开发模式）；各层的依赖方向、与 `@rukie/shared`/`@rukie/i18n` 的关系、能否 import `@rukie/agent` 类型；用哪种 lint 规则强制边界；SessionEvent 到 UI 状态的归约放在哪里，是否复用 `coding-agent/src/view/` 的逻辑（[01](01-packages-and-effect-boundary.md#answer) 定为不抽取）。

## Answer

2026-10-10 grilling 定稿。事实依据：`@rukie/shared` 的 `SessionEvent<PiEvent>` 是泛型，具体类型在 `packages/agent/src/session/events.ts`；TUI 的事件归约在 `coding-agent/src/view/conversation/conversation.ts` 并依赖 TUI i18n；`view/transcript/diff-lines.ts` 只依赖 shared 类型与 `diff`，`markdown.ts` 带终端专属的 mermaid 与 LaTeX 渲染；包边界现由 `.oxlintrc.json` 按目录的 `no-restricted-imports` 强制。

- 分层：`packages/ui/src/` 分 `app/`（屏幕装配，唯一接线层）、`components/`（React 组件，只收 props，不读 store、不连 client）、`store/`（Zustand store 与 wire 消息到 UI 状态的纯归约，无 React）、`client/`（WS wire client：连接、重连、请求 `id` 关联、订阅与补发，无 React、无 Zustand）、`host/`（只定义接口，由入口注入实现）。依赖方向 `app → components / store → client → @rukie/shared`，`host` 只被 `app` 与 `client` 使用。`store/` 与 `client/` 用 Vitest Node 环境测试，不需要浏览器。
- Agent Core 类型：ui 只以 `import type` 引 `@rukie/agent` 的 `SessionEvent` 等具体类型，lint 禁止值导入。不把具体类型放进 `@rukie/shared`（它只能依赖 typebox），也不让 ui 直接依赖 pi 类型。
- 归约与复用：SessionEvent 归约在 ui `store/` 重写，不复用 `coding-agent/src/view/`（与 [01](01-packages-and-effect-boundary.md#answer) 一致）。diff 行拆分在 ui 内基于 `diff` 8.0.4 重写（约 60 行），Markdown 在 ui 内用 micromark/mdast 解析后渲染为 React（tech-stack「Markdown」行）。两份实现各自测试。这也回答了 [14](14-research-specialized-libraries.md#answer) 关于复用 `diff-lines.ts` 的问题。
- 边界强制：沿用 `.oxlintrc.json` 按目录的 `no-restricted-imports`。`components/` 禁 `store/`、`client/`、`zustand`；`store/`、`client/` 禁 `react` 与 `components/`；整个 ui 禁值导入 `@rukie/agent`（`allowTypeImports`），禁 `@rukie/coding-agent`、`electron`、`node:*`、`bun`、`bun:*`。不引入 dependency-cruiser。
- 文案：ui 的 zh/en 字典放在 `packages/ui/src/i18n/`，用 `@rukie/i18n` 做 locale 解析与插值，wire 错误码的文案也在这里按 code 查找；`@rukie/i18n` 只放跨端公共文案。
- host 接口：`getConnection()`、`pickProjectFolder()`、`revealPath(path)`、`openInTerminal(path)`。浏览器开发模式下 `getConnection` 读 URL fragment，`pickProjectFolder` 改为手动输入路径，后两项不可用时隐藏对应菜单项（只影响开发模式）。主题跟随系统用 CSS `prefers-color-scheme`，不经 host。
