# 研究：本机 server 的 WS 鉴权方式

对应工单：[06](../issues/06-research-local-server-auth.md)。前置决策：[02](../issues/02-connection-and-process-semantics.md#answer)（一次性 token、校验 `Origin` 与 `Host`、只监听 `127.0.0.1`）。

## 结论

- token 放在 `Sec-WebSocket-Protocol` 里：`new WebSocket(url, ["rukie.v1", "rukie.auth." + token])`。服务端在 Hono 中间件里先校验 `Host`、`Origin` 和 token，三项都通过才交给 `upgradeWebSocket`。不用 query param，也不先换 cookie。
- 防 DNS rebinding 的做法：`Host` 必须精确等于 `127.0.0.1:<port>`，`Origin` 走白名单并精确比较。不能用 Hono 的 `csrf()`，也不能拿 `new URL(c.req.url).origin` 当基准。
- Electron 用 standard + secure 的自定义 scheme（如 `app://rukie`）加载 renderer，这时 `Origin` 是 `app://rukie`。`file://` 页面发出的 `Origin` 是字面量 `file://`，所有本地页面都相同，不能用来区分来源。
- token 由 main 保存。preload 通过 `contextBridge` 暴露一个窄函数 `getConnection()`，内部走 `ipcRenderer.invoke`，main 侧校验 `senderFrame` 的来源。不用 `additionalArguments`，因为它会出现在 renderer 进程的命令行里。
- 浏览器开发模式下，renderer 直连 sidecar，不经 Vite proxy。只有 sidecar 以开发标志启动时，才把 `http://localhost:5173` 加进 `Origin` 白名单（Vite 设 `strictPort`）。token 通过 URL fragment（`#token=`）传入，读出后立即用 `history.replaceState` 清掉。

## 证据

### Hono 4.13.12 + `@hono/bun` 1.0.0 的升级路径

- `@hono/bun` 的 `upgradeWebSocket` 会直接调用 `server.upgrade(c.req.raw, …)`，只取 `sec-websocket-protocol` 的第一项作为 `protocol`，自身不做任何校验（[`@hono/bun` 1.0.0 `dist/websocket.js` 第 21–29 行](https://www.npmjs.com/package/@hono/bun/v/1.0.0)）。
- `defineWebSocketHelper` 产出的是普通中间件：handler 返回 Response 时直接返回，否则 `next()`（[hono 4.13.12 `dist/helper/websocket/index.js` 第 33–41 行](https://www.npmjs.com/package/hono/v/4.13.12)）。所以挂在 WS 路由前面的中间件只要返回 401/403，就不会进入 `server.upgrade`。
- Bun 的 `server.upgrade(request, { headers, data })` 只支持附加响应头和 `data`（`bun-types@1.4.2` `serve.d.ts` 第 1032–1077 行，仓库已安装）。
- Hono `csrf()` 只拦截非 GET/HEAD/OPTIONS、且 content-type 属于表单类型的请求（hono 4.13.12 `dist/middleware/csrf/index.js` 中 `isSafeMethodRe` 与 `isRequestedByFormElementRe`）。WS 升级是 GET，`csrf()` 对它完全不生效。另外它默认拿来比较 Origin 的基准是 `new URL(c.req.url).origin`。
- 比较 token 可以复用 `timingSafeEqual`：它先比 SHA-256 再比原文，两步都是常量时间（hono 4.13.12 `dist/utils/buffer.js` 第 28–42 行；包导出 `./utils/*`）。

本地实验（`/tmp` 下的临时项目，Bun 1.4.2 + hono 4.13.12 + `@hono/bun` 1.0.0；Bun 客户端可以自定义 `Origin`/`Host`，借此模拟攻击者）：

| 场景                                       | 服务端看到的                                      | 结果                                      |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------- |
| 正确 token、无 Origin                      | `protos=["rukie.v1","rukie.auth.…"]`              | 升级成功，协商出的 protocol 是 `rukie.v1` |
| 错误 token                                 | —                                                 | 中间件返回 401，客户端收到 close 1002     |
| `Origin: http://evil.test`                 | —                                                 | 返回 403                                  |
| `Host: evil.test:<port>`（模拟 rebinding） | `c.req.url = http://evil.test:<port>/ws`          | 返回 403                                  |
| 原始握手                                   | 101 响应里只有 `Sec-WebSocket-Protocol: rukie.v1` | 不会回显 token                            |

推论：

- Bun 的 `c.req.url` 由 `Host` 头拼出来。DNS rebinding 时它会跟着变成攻击者的域名，所以基于 `c.req.url` 的“同源”比较会被绕过。`Host` 必须和启动时已知的 `127.0.0.1:<port>` 精确比较。
- Bun 回显第一个子协议，所以 `rukie.v1` 必须放第一位。RFC 6455 §4.1 要求，客户端请求了子协议时，服务端回应的值必须在客户端列表里，否则客户端放弃连接（[RFC 6455 §4.1](https://www.rfc-editor.org/rfc/rfc6455#section-4.1)、[§4.2.2](https://www.rfc-editor.org/rfc/rfc6455#section-4.2.2)）。
- 子协议的每个元素必须符合 HTTP token 语法（[RFC 6455 §4.1](https://www.rfc-editor.org/rfc/rfc6455#section-4.1)；违反时 WHATWG 规定 `new WebSocket` 抛 `SyntaxError`，见 [WebSockets Standard](https://websockets.spec.whatwg.org/#dom-websocket-websocket)）。token 用 base64url 且不带 `=` 即可满足。

### 三种 token 载体的取舍

| 载体                     | 优点                                                        | 风险或代价                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| query `?token=`          | 实现最简单                                                  | 进入请求行。Hono `logger()` 打印的 path 是 `url.slice(url.indexOf("/", 8))`，带 query（hono 4.13.12 `dist/middleware/logger/index.js` 第 41–43 行）。反向代理、DevTools 和浏览器开发模式的地址栏也都可能记录它。 |
| `Sec-WebSocket-Protocol` | 浏览器 API 原生支持；不进请求行和常见访问日志；服务端不回显 | DevTools 的 Network 面板请求头里仍然可见；服务端不能记录这个头；token 必须符合 token 字符集                                                                                                                      |
| 先用 HTTP 换 cookie      | 浏览器自动携带                                              | `app://rukie` 到 `http://127.0.0.1` 是 cross-site（实验中 `sec-fetch-site: cross-site`），cookie 会受第三方/SameSite 限制；需要额外的换票端点，且该端点本身也要鉴权；连上 sidecar 重启后的端口切换，状态更多     |

浏览器的 WebSocket API 只接受 `url` 和 `protocols` 两个参数，不能设置其他请求头（[WebSockets Standard](https://websockets.spec.whatwg.org/#the-websocket-interface)）。所以子协议是唯一既能走握手头、又不需要额外往返的方式。

### DNS rebinding

- 浏览器发起的 WS 握手必须带 `Origin`（[RFC 6455 §4.1](https://www.rfc-editor.org/rfc/rfc6455#section-4.1)；服务端应据此拒绝不期望的来源，见 [§10.2](https://www.rfc-editor.org/rfc/rfc6455#section-10.2)）。WS 不受同源策略和 CORS 约束，`Origin` 校验只能由服务端完成。
- Vite 文档把 `allowedHosts: true` 定性为 DNS rebinding 漏洞，并说明 Vite 代理 WS 前不检查 `Origin`，`rewriteWsOrigin` 会让目标端的检查失效（[Vite 8.3.1 server options：`server.allowedHosts`、`server.proxy`](https://github.com/vitejs/vite/blob/v8.3.1/docs/config/server-options.md)；[GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)）。
- 三层防线：token 是主防线，因为 rebinding 页面拿不到它；`Host` 精确匹配挡住改名后的请求；`Origin` 白名单挡住其他网页。缺少 `Origin` 的请求同样拒绝。测试用的 Bun 客户端可以显式设置 `Origin`。

### Electron 41 renderer 的 Origin

实验环境：Electron 41.10.7（`tech-stack` 锁定 41.0.3，同一大版本），`contextIsolation: true`、`sandbox: true`。页面从三种来源加载，分别对 `127.0.0.1` 的 Node 服务发起 `fetch` 和 `WebSocket`：

| 加载方式                                                  | `location.origin`         | WS 握手的 `Origin`        | `Sec-Fetch-Site` |
| --------------------------------------------------------- | ------------------------- | ------------------------- | ---------------- |
| `loadFile`（`file://`）                                   | `file://`                 | `file://`                 | `cross-site`     |
| `app://bundle`（`standard`、`secure`、`supportFetchAPI`） | `app://bundle`            | `app://bundle`            | `cross-site`     |
| `http://localhost:<port>`（模拟 Vite）                    | `http://localhost:<port>` | `http://localhost:<port>` | `cross-site`     |

- 官方建议用自定义 protocol 代替 `file://`，理由是 `file://` 权限过大（[Electron v41 security checklist #18](https://github.com/electron/electron/blob/v41.10.7/docs/tutorial/security.md#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols)）。
- 自定义 scheme 只有注册为 `standard` 才遵循通用 URI 语法，才有 host 和可用的 web storage。`registerSchemesAsPrivileged` 必须在 `ready` 之前调用，且只能调用一次（[Electron v41 `protocol` API](https://github.com/electron/electron/blob/v41.10.7/docs/api/protocol.md#protocolregisterschemesasprivilegedcustomschemes)、[CustomScheme](https://github.com/electron/electron/blob/v41.10.7/docs/api/structures/custom-scheme.md)）。实验中的非 standard scheme 没有测 Origin，本方案也不采用。
- 实验中 `app://` 的 handler 直接返回 HTML，`loadURL` 的 promise 以 `ERR_FAILED (-2)` 拒绝，但页面实际已加载并执行，`location.origin` 正确。按官方示例用 `net.fetch(pathToFileURL(…))` 返回文件时是否还会出现这个错误，没有验证，留给实现阶段确认。

### preload 注入 token

- `additionalArguments` 会追加到 renderer 的 `process.argv`（[WebPreferences](https://github.com/electron/electron/blob/v41.10.7/docs/api/structures/web-preferences.md)）。实验中 `ps -axo command` 能看到 `Electron Helper (Renderer) … --rukie-token=tok123`，同一用户下的任何进程都能读到，所以不用它传 token。
- 官方要求不要把 `ipcRenderer` 原样暴露给页面，只暴露包好的具体函数（[context isolation：Security considerations](https://github.com/electron/electron/blob/v41.10.7/docs/tutorial/context-isolation.md#security-considerations)），并且要校验所有 IPC 的 `senderFrame`（[security checklist #17](https://github.com/electron/electron/blob/v41.10.7/docs/tutorial/security.md#17-validate-the-sender-of-all-ipc-messages)）。
- 推荐形态：main 保存从 sidecar stdout 握手得到的 `{port, token}`；preload 暴露 `rukieHost.getConnection(): Promise<{url, token}>`，内部调用 `ipcRenderer.invoke("rukie:connection")`；main 的 handler 先确认 `new URL(e.senderFrame.url).origin === "app://rukie"`，再返回连接信息。sidecar 重启后端口和 token 都会变，renderer 重连时要重新调用它，不缓存旧值。
- 剩余风险：token 进入页面上下文后，renderer 里的 XSS 能读到它。用严格 CSP 缓解（security checklist #7）。

### 浏览器开发模式

- Vite 默认端口 5173；设置 `strictPort: true` 后，端口被占用时直接退出，不会换端口（[Vite 8.3.1 `server.port`、`server.strictPort`](https://github.com/vitejs/vite/blob/v8.3.1/docs/config/server-options.md)）。这样 `Origin` 白名单是确定的。
- 不经 Vite proxy 的理由：Vite 不检查 WS `Origin`，而且 `changeOrigin` 和 `rewriteWsOrigin` 会改写 `Host` 和 `Origin`，sidecar 的校验就失去依据（同上，`server.proxy` 警告）。
- Electron 开发模式加载 Vite URL 时，`Origin` 同样是 `http://localhost:5173`（见上表第三行），复用同一条开发白名单即可。
- 开发白名单由启动方显式传给 sidecar（例如 `--dev-origin http://localhost:5173`），生产 sidecar 只接受 `app://rukie`。token 放在 URL fragment 里：fragment 不随 HTTP 请求发送，所以不会进入 Vite 日志（[RFC 3986 §3.5](https://www.rfc-editor.org/rfc/rfc3986#section-3.5)），读出后立即用 `history.replaceState` 清掉。

## 中间件草图

```ts
import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "hono/utils/buffer";

const PROTOCOL = "rukie.v1";
const AUTH_PREFIX = "rukie.auth.";

/** Rejects before upgrade; `expectedHost` is `127.0.0.1:<bound port>`, known after `Bun.serve`. */
function guardUpgrade(opts: {
  expectedHost: () => string;
  origins: ReadonlySet<string>;
  token: string;
}) {
  return createMiddleware(async (c, next) => {
    if (c.req.header("host") !== opts.expectedHost()) return c.text("forbidden", 403);
    const origin = c.req.header("origin");
    if (origin === undefined || !opts.origins.has(origin)) return c.text("forbidden", 403);
    const offered = (c.req.header("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
    // Bun echoes the first offered protocol; the auth element must never be first.
    if (offered[0] !== PROTOCOL) return c.text("bad protocol", 400);
    const presented = offered.find((p) => p.startsWith(AUTH_PREFIX))?.slice(AUTH_PREFIX.length);
    if (presented === undefined || !(await timingSafeEqual(presented, opts.token)))
      return c.text("unauthorized", 401);
    await next();
  });
}
```

用法：`app.get("/ws", guardUpgrade(opts), upgradeWebSocket(…))`，`Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket })`。日志中间件不能输出 `sec-websocket-protocol` 头。

## 未验证

- 没有在真实 Chromium 浏览器里重放子协议握手；Electron 实验用的是同一个 Chromium 网络栈。
- 非 standard 自定义 scheme 和 `file://` 页面下的 cookie 行为没有测，本方案不依赖它们。
- 实验用 Electron 41.10.7 和 Bun 1.4.2；仓库锁定的是 Electron 41.0.3。Vite 8.3.1 只查了文档，没有运行。
