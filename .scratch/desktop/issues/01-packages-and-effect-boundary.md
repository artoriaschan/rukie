# 01: 包结构与 Effect 边界

Type: grilling

Blocked by: None

Status: resolved

## Question

桌面端代码如何分包，GUI 与终端呈现是否共享 UI 层，Effect 接入到哪一层，与 Hono、TypeBox 如何分工？

## Answer

- 新建 `packages/ui`（React DOM 组件、Zustand 状态、server client、可注入 host 接口）、`packages/server`（Bun server，Agent Core 的网络 frontend）、`packages/desktop`（Electron main、preload、sidecar 管理、打包；renderer 的 Vite 入口兼作浏览器开发模式）。
- 不建 `packages/web`；Web 产品出现时再建并复用 `ui`。
- GUI 与终端是两套设计标准：`coding-agent/src/view/` 不抽出，继续只服务 TUI 与 Headless。这推翻 ADR-0012 中“view 在引入 web 或桌面端时整体抽成 UI 包”的说法，需要新 ADR。跨端只共享 `@rukie/shared` 的协议类型。
- Hono 是 HTTP 接入层：路由、中间件、请求校验、响应、WebSocket。Effect 是 server 内的应用与业务运行层：业务编排、依赖注入、错误管理、并发任务、资源生命周期。
- Effect 不出 server 边界：Agent Core 不迁移，`ui` 不依赖 effect。
- wire 协议用 TypeBox 定义在 `@rukie/shared`，Hono 用它校验，Effect 层只接收校验后的类型。
