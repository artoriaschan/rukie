---
status: accepted
---

# Agent 运行在 Bun sidecar 进程，而不是 Electron main

## 问题

Agent Core 需要在 Headless CLI 与未来桌面端共享运行时，同时支持 Bun 专有 API。

## 决定

Agent Core 跑在 Bun 进程里。headless 阶段由 CLI 直接调用；桌面端阶段由 Electron main 以 sidecar 方式拉起 Bun server（Hono + `@hono/bun` WebSocket），渲染进程通过 WS 与 agent 通信。这样 CLI、server 和桌面端共用同一个运行时和同一份 Agent Core，可以直接使用 `bun:sqlite`、`Bun.spawn`、`Bun.Glob`。代价是桌面端多一个子进程，需要管理它的生命周期。

桌面端的 sidecar 是 `@rukie/server` 经 `bun build --compile` 得到的单文件可执行程序，与 ripgrep 一起放在应用包的 `Contents/Resources/sidecar/`，不进 asar。server 的内部分层见 [ADR-0030](0030-desktop-server-hono-and-effect.md)，与渲染进程的协议见 [ADR-0031](0031-desktop-wire-protocol-and-local-auth.md)，启动、停止与签名细节见[桌面端 spec](../../.scratch/desktop/spec.md)。

## 备选方案

历史记录未列出独立的备选方案；现有取舍保留在决定正文中。

## 影响

桌面端采用 sidecar 时需要管理额外子进程。桌面端是已接受的目标设计，当前运行组成以[架构](../architecture.md)为准。
