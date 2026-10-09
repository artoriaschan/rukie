# 06: 本机 server 的 WS 鉴权方式

Type: research

Blocked by: None

Status: resolved

## Question

在 Hono 4.13.12 + `@hono/bun` 1.0.0 上，WS 升级前如何校验 token、`Origin` 与 `Host`（浏览器 WS 不能自定义 header，token 走 query、subprotocol 还是先换 cookie）？Electron 41 renderer 加载 `file://` 或自定义 protocol 时 Origin 是什么，preload 如何安全注入 token？浏览器开发模式下 Vite dev server 的 Origin 如何放行？

## Answer

完整调研：[research/local-server-auth.md](../research/local-server-auth.md)。握手与 Origin 行为经本地实验验证（Electron 41.10.7，实验文件已删除）。

- token 传递：WS subprotocol `new WebSocket(url, ["rukie.v1", "rukie.auth." + token])`。`upgradeWebSocket` 之前的 Hono 中间件校验 Host、Origin 与 token（`timingSafeEqual`），失败返回 401/403、不升级。Bun 只回第一个 subprotocol，`rukie.v1` 必须排在首位，token 不会被回显。`@hono/bun` 自身不做校验。
- 不选 query（进入 `logger()` 等日志）与 cookie 交换（跨站、受 SameSite 限制、需额外端点）；代价是 token 出现在 DevTools 请求头。
- DNS rebinding：Host 精确等于 `127.0.0.1:<port>`；Origin 精确匹配白名单，缺失即拒绝。不用 Hono `csrf()`（跳过 GET，含 WS 升级），不用 `new URL(c.req.url).origin`（由 Host 构造，攻击者可控）。
- Electron Origin：`file://` 页面发送字面 `Origin: file://`，所有本地页面相同；注册为 standard + secure 的自定义 scheme 发送 `app://<host>`。生产使用 `app://rukie` 并只放行该 Origin。
- token 注入：不用 `additionalArguments`（已证实出现在 `ps` 中）。main 持有 `{port, token}`，preload 经 `contextBridge` 只暴露 `getConnection()`（`ipcRenderer.invoke`），main 校验请求来自 `app://rukie`；sidecar 重启后端口与 token 都变，renderer 每次重连都重新获取。
- 浏览器开发模式：直连 sidecar，不经 Vite proxy（Vite 不校验 WS Origin，`rewriteWsOrigin` 会绕过 sidecar 校验）。Vite `strictPort: true`；仅当 sidecar 以 dev 标志启动时把 `http://localhost:5173` 加入白名单；token 经 URL fragment `#token=` 传入，读取后 `history.replaceState` 清除。
- 未验证：真实 Chromium 浏览器握手；仓库锁定的 Electron 41.0.3（实验用 41.10.7）；Vite 8.3.1 仅读文档；实验中 `app://` 的 `loadURL` 报 `ERR_FAILED (-2)` 但页面正常运行，按官方示例提供文件是否消除未查。
