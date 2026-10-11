---
status: accepted
---

# 测试跑在生产代码所在的运行时上：Bun 代码用 bun:test，Electron 和渲染进程用 Vitest

## 问题

测试运行时需要覆盖生产代码使用的专有 API，以及未来桌面端的 Node 与浏览器环境。

## 决定

运行在 Bun 上的包（agent、cli、server）用 `bun:test`，这样 Bun 专有 API 可以直接测，不必让 Vitest 跑在 Bun 上而碰到兼容问题。Electron main 和渲染进程用 Vitest 5，因为渲染进程测试需要 Vite 插件和 browser mode，main 进程则运行在 Node 上。两种 runner 按运行时分开；仓库分别通过 Bun 与 Vitest 入口执行这些测试。

桌面端的接入方式：`@rukie/ui` 用 Vitest browser mode（Playwright Chromium），其中不依赖 React 的 `store` 与 `client` 用 Node 环境；`@rukie/desktop` main 用 Node 环境并替换 Electron API。根目录 `bunfig.toml` 让 `bun test` 不收集这两个包的测试，`check:test-policy` 禁止跨 runner 导入。版本与命令见[桌面端 spec](../../.scratch/desktop/spec.md)。

## 备选方案

历史记录未列出独立的备选方案；现有取舍保留在决定正文中。

## 影响

按生产运行时维护测试入口。Bun 与 Vitest 已分别接入。桌面端测试只在本地 `check` 中运行，不进入 CI。
