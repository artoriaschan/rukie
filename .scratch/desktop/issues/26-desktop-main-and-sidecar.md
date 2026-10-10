# 26: desktop main、preload 与 sidecar 生命周期

**What to build:** Electron 外壳：`app://rukie` 文件服务与 CSP、preload 的 host 接口、sidecar 的启动、握手、停止与重启。见 [spec](../spec.md) 的「渲染进程能力（host）」「desktop main 与 sidecar」。

Blocked by: 23, 24

Status: ready-for-agent

- [ ] `ready` 前注册 `app` scheme（standard、secure、supportFetchAPI）；`loadURL` 前在窗口 session 上 `protocol.handle`；只认 host `rukie`，解码后防越界，SPA 回退 `index.html`，显式 content-type，HTML 附 CSP（`connect-src ws://127.0.0.1:*`）
- [ ] preload 经 `contextBridge` 暴露 `getConnection`、`pickProjectFolder`、`revealPath`、`openInTerminal`，main 校验调用来源为 `app://rukie`
- [ ] 启动 sidecar 时剔除 `BUN_BE_BUN`、`BUN_OPTIONS`、`DYLD_*`、`NODE_OPTIONS`；10 秒无握手判定失败
- [ ] 停止一律 SIGTERM，5 秒后 SIGKILL；意外退出通知 renderer 并自动重启一次，第二次后不再重启，由「重试」手动重启
- [ ] 窗口关闭时 abort 仍在运行的 Run
- [ ] 接缝：Vitest Node + `vi.mock("electron")` 驱动假 sidecar 脚本
