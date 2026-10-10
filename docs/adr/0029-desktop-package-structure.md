---
status: accepted
---

# 桌面端拆成 ui、server、desktop 三个包，GUI 不复用终端的 view 层

## 问题

桌面端需要 React DOM 界面、跑 Agent Core 的本机 server 和 Electron 外壳，还要为将来的 Web 产品留口子。[ADR-0012](0012-single-coding-agent-package.md) 原先打算在引入 web 或桌面端时，把 `coding-agent/src/view/` 整体抽成 UI 包供各端复用。

## 决定

新增三个 workspace 包：

- `@rukie/ui`：React DOM 界面，不依赖 Electron，浏览器开发模式和将来的 Web 产品都能复用。
- `@rukie/server`：Bun 本机 server，Agent Core 的网络 frontend，作为 sidecar 运行（[ADR-0001](0001-agent-runs-in-bun-sidecar.md)）。
- `@rukie/desktop`：Electron main、preload、sidecar 管理与打包，渲染进程的 Vite 入口同时作为浏览器开发模式。

GUI 与终端是两套设计标准，`coding-agent/src/view/` 不抽出，继续只服务 TUI 与 Headless CLI。跨端只共享 `@rukie/shared` 中的协议类型。SessionEvent 归约、diff 行拆分与 Markdown 渲染在 ui 内重写，与 TUI 的实现各自测试。

`@rukie/ui` 内部分五层，依赖只向下：

- `app`：屏幕装配，唯一接线层；
- `components`：只收 props 的 React 组件；
- `store`：Zustand store 与 wire 消息的纯归约，无 React；
- `client`：WS wire client，无 React 与 Zustand；
- `host`：原生能力接口，由入口注入。

依赖方向为 `app → components / store → client → @rukie/shared`，`host` 只被 `app` 与 `client` 使用。ui 对 `@rukie/agent` 只做类型导入，不导入 `@rukie/coding-agent`、`electron` 或 Node/Bun API。这些边界由 `.oxlintrc.json` 按目录的 `no-restricted-imports` 强制。

本决定部分替代 ADR-0012 中“view 在引入 web 或桌面端时整体抽成 UI 包”一句，ADR-0012 的其余内容继续有效。规划依据见[桌面端地图](../../.scratch/desktop/map.md)的 01 与 19。

## 备选方案

- 把 `view/` 抽成共享包，GUI 与 TUI 共用：view 里的归约与呈现按终端的 cell 网格、ANSI 和 TUI i18n 设计，GUI 用不上大部分，强行共享会让两端互相牵制。
- 只把纯函数（如 diff 行拆分）抽进新包：只涉及约 60 行代码，新开一个包的维护成本高于重复实现。
- ui 直接 import `@rukie/coding-agent` 的 view：会让 GUI 依赖 TUI 包及其依赖树。
- 只建 `desktop` 一个包：renderer、server 与 Electron 混在一起，将来做 Web 产品时还要再拆。

## 影响

两端各维护一份事件归约、diff 与 Markdown 实现，各自测试。ui 不依赖 Electron，浏览器开发模式与将来的 Web 产品可以复用。包边界一旦建立就难以合并。实施工单见[桌面端 spec](../../.scratch/desktop/spec.md)。
