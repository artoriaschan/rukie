# 13: Vitest 在 ui 与 desktop 的接入

Type: research

Blocked by: None

Status: needs-triage

## Question

ADR-0004 规定 Electron main 与 renderer 用 Vitest。在 Bun workspace 中：`packages/ui` 用 Vitest browser mode（provider、浏览器、与 Vite 8.3.1 的版本兼容）还是 jsdom/happy-dom；`packages/desktop` main 进程的 Node 测试怎么跑；如何接入根 `bun run check`、`check:test-policy` 与 CI 分片；需要锁定哪些精确版本？产出可执行的配置建议与版本表。
