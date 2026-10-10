# 26: desktop main、preload 与 sidecar 生命周期

**What to build:** Electron 外壳：`app://rukie` 文件服务与 CSP、preload 的 host 接口、sidecar 的启动、握手、停止与重启。见 [spec](../spec.md) 的「渲染进程能力（host）」「desktop main 与 sidecar」。

Blocked by: 23, 24

Status: claimed

- [x] `ready` 前注册 `app` scheme（standard、secure、supportFetchAPI）；`loadURL` 前在窗口 session 上 `protocol.handle`；只认 host `rukie`，解码后防越界，SPA 回退 `index.html`，显式 content-type，HTML 附 CSP（`connect-src ws://127.0.0.1:*`）
- [x] preload 经 `contextBridge` 暴露 `getConnection`、`pickProjectFolder`、`revealPath`、`openInTerminal`，main 校验调用来源为 `app://rukie`
- [x] 启动 sidecar 时剔除 `BUN_BE_BUN`、`BUN_OPTIONS`、`DYLD_*`、`NODE_OPTIONS`；10 秒无握手判定失败
- [x] 停止一律 SIGTERM，5 秒后 SIGKILL；意外退出通知 renderer 并自动重启一次，第二次后不再重启，由「重试」手动重启
- [ ] 窗口关闭时 abort 仍在运行的 Run
- [x] 接缝：Vitest Node + `vi.mock("electron")` 驱动假 sidecar 脚本

## Implementation evidence

2026-10-11: issue 26 uses a fresh implementation agent on `feat/desktop-26`. `packages/desktop/src/main.ts` and `preload.ts` supply the real Electron entry and precisely four host methods. `main/desktop.ts` validates the invoking main frame and sender WebContents, installs the privileged scheme before ready and session handler before loadURL, blocks foreign navigation/new windows, and enables sandbox/context isolation with Node disabled. `main/protocol.ts` checks decoded and real paths, SPA fallback, MIME and HTML CSP. `main/sidecar.ts` owns scrubbed spawn, handshake, deadlines, awaited exit, one automatic restart and explicit getConnection retry. Connection changes use the DOM event `rukie:connection-change` without a fifth host method.

Window close and application quit wait for sidecar SIGTERM shutdown, escalating only at 5 seconds. Server's explicit active Run abort before Session close is coordinated with issue 25; the window-close checkbox remains pending its integration/review. Development uses Bun source; production uses `Resources/sidecar/rukie-server`. `RUKIE_DESKTOP_USER_DATA` and independent HOME support the later isolated Electron smoke without real settings.

Approved seams: Node Vitest mock Electron and a real fake-sidecar subprocess. Red evidence was the absent main/sidecar/protocol modules; green evidence covers validated handshake/environment, the exact 10-second deadline, TERM at shutdown and KILL only at 5 seconds, automatic recovery once plus manual retry, missing executable cleanup, trusted IPC sender, four preload methods, window close and path containment. Parent timers use fake clocks, subprocess cleanup waits actual exit. Focused desktop: 10 tests pass, about 0.55 seconds; all tests are below one second, and real subprocess startup/exit is required integration evidence. `bunx --no -- playwright install --only-shell chromium` passed. `bun run test:desktop`: 7 files / 12 tests pass (553 ms). `bun run check:dev` passed after code and documentation edits. No local full Bun suite or packaged Electron smoke claimed; issue 30 owns packaged smoke.

ADR Coverage: follows spec's existing ADR-0001 (Bun sidecar), ADR-0031 (loopback/authenticated connection), and ADR-0032 (server-owned settings/store). Native capability ownership and app protocol retain the accepted decisions, with no new architecture trade-off. Ticket stays claimed for independent review and integration.
