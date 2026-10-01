# Agent 运行在 Bun sidecar 进程，而不是 Electron main

Agent Core 跑在 Bun 进程里。headless 阶段由 CLI 直接调用；桌面端阶段由 Electron main 以 sidecar 方式拉起 Bun server（Hono + `@hono/bun` WebSocket），渲染进程通过 WS 与 agent 通信。这样 CLI、server 和桌面端共用同一个运行时和同一份 Agent Core，可以直接使用 `bun:sqlite`、`Bun.spawn`、`Bun.Glob`。代价是桌面端多一个子进程，需要管理它的生命周期。
