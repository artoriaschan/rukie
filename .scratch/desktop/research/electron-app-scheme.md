# 研究：Electron app:// 协议的文件服务与 Origin 复核

回答 [工单 16](../issues/16-research-electron-app-scheme.md)。前置结论：[06](../issues/06-research-local-server-auth.md#answer)（生产 Origin 白名单只放行 `app://rukie`）、[11](../issues/11-research-sidecar-packaging.md#answer)（fuses 2.0.0 在 `afterPack` 调用）。版本基线：Electron 41.0.3、@electron/fuses 2.0.0、@electron/asar（npm 最新版，仅用于实验打包）、Node 24.15.0（实验中的 npm 与 fuses 脚本）。

来源分两类：固定到 `v41.0.3` tag 的 Electron 官方文档（标“文档”），以及 2026-10-10 在 macOS arm64 上用 Electron 41.0.3 完成的本地实验（标“实测”）。实验用 `show: false` 的 `BrowserWindow`，`contextIsolation: true`、`sandbox: true`，页面执行完成后由 main 调用 `app.quit()`。实验目录 `/tmp/rukie-research-16-*` 已删除，没有残留进程。Vite 8.3.1 没有实际运行，只按其产物形态手写了 `index.html` 与 `assets/main.js`。

## 结论

1. 在 `app.whenReady()` 之前调用一次 `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }])`。在 `ready` 之后、`loadURL` 之前，对窗口所用 session 调用 `protocol.handle("app", …)`。不需要 `corsEnabled`、`bypassCSP`、`allowServiceWorkers` 或 `stream`。
2. handler 只接受 host `rukie`。它先对 pathname 做 `decodeURIComponent`，再用 `path.resolve` + `path.relative` 判断路径是否在 `dist` 内，越界返回 403。扩展名为空的路径回退到 `index.html`。文件用 `net.fetch(pathToFileURL(…))` 读取，失败时返回 404。handler 自己设置 `content-type`，并在 HTML 响应上加 CSP 头。handler 内部绝不能抛错。
3. `ERR_FAILED (-2)` 在 41.0.3 上有三种复现方式：请求到达时该 session 还没有注册 handler（`protocol.handle` 晚于 `loadURL`，或者窗口用了自定义 `partition`），以及主文档响应为 `application/octet-stream`。handler 抛错时则报 `ERR_UNEXPECTED (-9)`。按第 2 条实现后，`loadURL` 能正常 resolve（实测）。06 中“报 -2 但页面仍在运行”的现象没有复现出来，原因见第 3 节。
4. 页面从 `app://rukie` 加载时，WS 握手与 `fetch` 发出的 `Origin` 都是字面量 `app://rukie`（不带端口和尾斜杠），`Sec-Fetch-Site` 为 `cross-site`（实测，41.0.3）。06 用 41.10.7 得到的结论在锁定版本上同样成立。
5. CSP 由 handler 写在 HTML 响应头里：`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src ws://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`。`'self'` 覆盖 Vite 输出的 `type="module" crossorigin` 脚本和 `modulepreload`。`connect-src` 用端口通配，sidecar 重启换端口后不需要重载页面。真正的访问控制仍是 server 侧的 Origin/Host/token 校验。
6. Fuses 与 `app://` 互不干扰。在 `OnlyLoadAppFromAsar`、`GrantFileProtocolExtraPrivileges: false`、`RunAsNode: false` 等全部打开（关闭）的打包副本上，main 用 `net.fetch(file://…/app.asar/dist/…)` 读取 asar 内的文件，`app://` 页面、Origin、CSP 和 SPA 回退的表现与开发态完全一致（实测）。`GrantFileProtocolExtraPrivileges: false` 只影响 `file://` 页面，采用 `app://` 后应关闭它。

## 1. 注册与 handler

- `registerSchemesAsPrivileged` 只能在 `ready` 之前调用，而且只能调用一次，所有自定义 scheme 必须放进同一次调用（文档：[protocol](https://github.com/electron/electron/blob/v41.0.3/docs/api/protocol.md#protocolregisterschemesasprivilegedcustomschemes)）。
- 各项权限的作用：
  - `standard`：使 scheme 遵循 RFC 3986 通用语法，相对 URL 能正确解析，并且能使用 web storage。不加时，本 scheme 下的 storage 被禁用（文档：同上）。实测中，未注册为 privileged 的 `app://rukie` 页面能够加载，但 `<script src="/assets/main.js">` 被 `script-src 'self'` 拦截，页面不可用。
  - `secure`：使 `app://rukie` 成为安全上下文。
  - `supportFetchAPI`：允许页面对本 scheme 调用 `fetch`。
  - 各字段的默认值都是 false（文档：[CustomScheme](https://github.com/electron/electron/blob/v41.0.3/docs/api/structures/custom-scheme.md)）。实测中，只开这三项时，`localStorage` 可用；同源 `type="module" crossorigin` 脚本、`modulepreload` 和 `fetch("/assets/main.js")` 都能成功，不需要 `corsEnabled`。
  - `bypassCSP` 会让本 scheme 的资源绕过 CSP，不应开启。
  - `codeCache` 能为 V8 启用代码缓存，前提是 `standard` 为 true。是否值得开没有测，留给实现阶段评估。
- `protocol` 注册在具体的 session 上。窗口一旦用了 `partition` 或 `session`，就必须在那个 session 上调用 `ses.protocol.handle`（文档：[protocol 中「Using protocol with a custom partition or session」](https://github.com/electron/electron/blob/v41.0.3/docs/api/protocol.md#using-protocol-with-a-custom-partition-or-session)）。MVP 只有一个窗口，使用默认 session 即可。
- 官方示例同样用 `path.resolve` 加 `path.relative` 防止目录越界，再用 `net.fetch(pathToFileURL(…))` 返回文件（文档：[`protocol.handle`](https://github.com/electron/electron/blob/v41.0.3/docs/api/protocol.md#protocolhandlescheme-handler)）。示例没有处理解码、SPA 回退和 404。

推荐的 handler 形态（实测版本的精简）：

```ts
const DIST = path.join(app.getAppPath(), "dist"); // inside app.asar when packaged
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

protocol.handle("app", async (request) => {
  const url = new URL(request.url);
  if (url.host !== "rukie") return new Response("not found", { status: 404 });
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const file = path.resolve(DIST, "." + pathname);
  const rel = path.relative(DIST, file);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    return new Response("forbidden", { status: 403 });
  // Client-side routes have no extension; assets always do.
  const target = rel === "" || path.extname(file) === "" ? path.join(DIST, "index.html") : file;
  const res = await net.fetch(pathToFileURL(target).toString()).catch(() => null);
  if (res === null || !res.ok) return new Response("not found", { status: 404 });
  const ext = path.extname(target);
  const headers = new Headers({ "content-type": MIME[ext] ?? "application/octet-stream" });
  if (ext === ".html") headers.set("content-security-policy", CSP);
  return new Response(res.body, { status: 200, headers });
});
```

### 路径与 URL 行为（实测）

| 请求                           | Chromium 交给 handler 的路径        | 结果                                            |
| ------------------------------ | ----------------------------------- | ----------------------------------------------- |
| `app://rukie`（无尾斜杠）      | `/`                                 | `index.html`，`location.href` 为 `app://rukie/` |
| `app://RUKIE/`                 | host 规范化为 `rukie`               | 正常加载，`location.origin` 为 `app://rukie`    |
| `app://other/`                 | host `other`                        | handler 返回 404 正文，页面不执行               |
| `/sessions/abc`                | 无扩展名                            | 回退到 `index.html`，200                        |
| `/assets/missing.js`           | `net.fetch` 报 `ERR_FILE_NOT_FOUND` | 404                                             |
| `/%2e%2e/%2e%2e/secret.txt`    | URL 解析器已折叠为 `/secret.txt`    | 落在 `dist` 内，文件不存在，404                 |
| `/assets/..%2f..%2fsecret.txt` | `%2f` 保留，解码后得到 `../`        | 越界检查拦截，403                               |

由此可知，URL 解析器只会折叠字面量 `..` 和 `%2e%2e`，不会还原 `%2f`。只要 handler 会解码路径，就必须在解码之后做越界检查。

### MIME

- 对 `file://` 地址调用 `net.fetch`，返回的 `content-type` 按扩展名推断：`.html` 为 `text/html`，`.js` 为 `text/javascript`（实测）。直接透传 `net.fetch` 的 Response 也能运行，但 404 与 CSP 头都需要自行处理，所以推荐在 handler 中重新构造 Response。
- 模块脚本受严格 MIME 检查：`application/octet-stream` 和 `text/plain` 都会被拒绝，控制台报 `Failed to load module script: Expected a JavaScript-or-Wasm module script…`（实测）。
- 主文档没有 `content-type` 时，正文被当作纯文本显示在 `<pre>` 里；为 `application/octet-stream` 时导航失败，报 `ERR_FAILED (-2)`（实测）。

## 2. Origin（实测，Electron 41.0.3）

页面为 `app://rukie/`，main 进程里启动了两个 Node `http` server，都只监听 `127.0.0.1` 的随机端口，并打印收到的请求头：

| 渲染进程发起的请求                          | 服务端看到的 `Origin` | `Sec-Fetch-Site` | 备注                                     |
| ------------------------------------------- | --------------------- | ---------------- | ---------------------------------------- |
| `new WebSocket("ws://127.0.0.1:<port>/ws")` | `"app://rukie"`       | —                | `Host: 127.0.0.1:<port>`                 |
| `fetch("http://127.0.0.1:<port>/echo")`     | `"app://rukie"`       | `cross-site`     | 服务端需回 `Access-Control-Allow-Origin` |
| 以 `app://RUKIE/` 加载后发起的 WS           | `"app://rukie"`       | —                | host 已被规范化                          |

在 `Contents/Resources/app.asar` 中打包、并已翻转 fuses 的 `.app` 副本上，结果相同。server 侧白名单精确比较字符串 `app://rukie` 即可（[06](local-server-auth.md#electron-41-renderer-的-origin)）。

## 3. `ERR_FAILED (-2)` 的成因（实测）

| 场景                                                              | `loadURL` 结果                   | 页面是否执行 |
| ----------------------------------------------------------------- | -------------------------------- | ------------ |
| 按第 1 节实现                                                     | resolve                          | 是           |
| `protocol.handle` 写在 `loadURL` 之后                             | reject `ERR_FAILED (-2)`         | 否           |
| 窗口使用 `partition: "persist:other"`，handler 注册在默认 session | reject `ERR_FAILED (-2)`         | 否           |
| 主文档 `content-type: application/octet-stream`                   | reject `ERR_FAILED (-2)`         | 否           |
| handler 抛错，或 `net.fetch` 读取目录时 reject                    | reject `ERR_UNEXPECTED (-9)`     | 否           |
| handler 返回 404                                                  | resolve，显示 404 正文           | 否           |
| 返回 HTML 但不带 `content-type`                                   | resolve，按纯文本显示            | 否           |
| 对同一 URL 连续调用两次 `loadURL`                                 | 第一次 reject `ERR_ABORTED (-3)` | 是           |
| 根路径返回 302 跳到 `/index.html`                                 | resolve                          | 是           |

- 06 的实验用的是 41.10.7，handler 直接返回 HTML，记录的现象是“reject -2 但页面在运行”。在 41.0.3 上，上表中所有报 -2 的场景页面都没有执行；唯一“reject 但页面运行”的组合是重复导航，而它报的是 -3。06 的实验代码已经删除，无法确认确切原因，最可能是导航被重复触发或 handler 晚于 `loadURL` 注册（推断，未验证）。
- 避免方法：在 `whenReady` 中先完成 `protocol.handle`，再创建窗口并 `loadURL`；handler 显式设置 `content-type`，用 `try/catch` 把所有失败转成 HTTP 状态码。main 侧监听 `did-fail-load` 并记录 `errorCode`，以便区分 -2、-3 和 -9。

## 4. CSP

- 官方建议给页面设置 CSP。可以用 HTTP 头或 `<meta>`；自定义 protocol 的页面可以在 handler 中直接设置响应头（文档：[security checklist #7](https://github.com/electron/electron/blob/v41.0.3/docs/tutorial/security.md#7-define-a-content-security-policy)）。
- 实测中，handler 给 HTML 响应加 CSP 头即可生效：
  - `script-src 'self'` 放行 `app://rukie/assets/*.js`，包括 `type="module" crossorigin` 和 `<link rel="modulepreload" crossorigin>`，并拦截 `eval`（`EvalError`）。
  - `connect-src 'self' ws://127.0.0.1:<端口A>` 时，连接端口 B 的 WS 与 `fetch` 被拦截，控制台给出违反 `connect-src` 的提示，页面上触发 `securitypolicyviolation`。
  - `connect-src 'self' ws://127.0.0.1:*` 放行任意端口的 WS，但不放行 `http://127.0.0.1:*`。
- 推荐 `connect-src ws://127.0.0.1:*`。理由：
  - sidecar 重启后端口会变（[02](../issues/02-connection-and-process-semantics.md#answer)）。CSP 在 HTML 响应时就已固定，写死端口意味着每次重启都要重载页面。
  - 按 [10](../issues/10-wire-protocol-messages.md#answer)，命令全部走 WS，renderer 不需要向 sidecar 发 HTTP 请求。
  - 防止页面连接到非 sidecar 的本机端口，是 CSP 的纵深防御；sidecar 自己的 Origin/Host/token 校验不依赖它。
- Vite 方面（未运行 Vite，按 Vite 默认行为推断）：
  - 默认 `base: "/"` 生成以 `/assets/` 开头的绝对路径，在 standard scheme 下能正确解析，无需改成相对路径。
  - 小于 `build.assetsInlineLimit` 的资源会被内联成 `data:` URI，所以 `img-src` 与 `font-src` 需要放行 `data:`。
  - 运行时通过 CSSOM 设置 `element.style` 不受 `style-src` 限制。如果第三方组件注入 `<style>` 元素或 `style=""` 属性，需要为 `style-src` 补 `'unsafe-inline'` 或 nonce。beUI/motion 的具体行为留给实现时用浏览器验证。
- 浏览器开发模式与 Electron 加载 Vite dev server 时，页面不经过这个 handler，CSP 由 Vite 的配置负责，也可以不设。开发模式的 Origin 白名单见 06。

## 5. Fuses 的配合

实测方法：复制 `node_modules/electron/dist/Electron.app`，用 `@electron/asar` 把实验 app 打成 `Contents/Resources/app.asar`。然后用 @electron/fuses 2.0.0 调用 `flipFuses`，参数为 `resetAdHocDarwinSignature: true`，以及 `RunAsNode: false`、`EnableCookieEncryption: true`、`EnableNodeOptionsEnvironmentVariable: false`、`EnableNodeCliInspectArguments: false`、`OnlyLoadAppFromAsar: true`、`LoadBrowserProcessSpecificV8Snapshot: false`、`GrantFileProtocolExtraPrivileges: false`。翻转后 `codesign -v` 通过，读回的 fuse wire 一共 9 位，第 9 位 `WasmTrapHandlers` 保持默认开启。

| Fuse                                                                                    | 对 `app://` 方案的影响                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OnlyLoadAppFromAsar: true`                                                             | 只从 `app.asar` 查找 app 代码（文档：[fuses](https://github.com/electron/electron/blob/v41.0.3/docs/tutorial/fuses.md#onlyloadappfromasar)）。实测中 handler 用 `app.getAppPath()` 定位 `app.asar/dist`，`net.fetch(file://…app.asar/…)` 能透明读取 asar 内的文件，页面、SPA 回退、404 与越界检查都正常。                                                                                                                                                         |
| `GrantFileProtocolExtraPrivileges: false`                                               | 文档写明：不再从 `file://` 提供页面就应关闭它（[fuses](https://github.com/electron/electron/blob/v41.0.3/docs/tutorial/fuses.md#grantfileprotocolextraprivileges)）。实测中，main 进程的 `net.fetch(file://)` 不受影响；在同一个打包副本里，`loadFile` 加载 asar 内的 HTML 报 `ERR_FILE_NOT_FOUND`，页面内对 `file://` 的 `fetch` 失败，`location.origin` 为 `null`。这个副本同时启用了 asar，没有单独隔离是哪个因素导致的；但它说明打包后不能回退到 `loadFile`。 |
| `EnableEmbeddedAsarIntegrityValidation: true`                                           | 实测：打开 fuse 后，只要 Info.plist 的 `ElectronAsarIntegrity` 里没有 `Resources/app.asar` 条目（官方二进制只带 `default_app.asar` 的条目），应用照常运行，也就是不做校验；手工写入错误的 hash 并重新做 ad-hoc 签名后，进程以 `FATAL … Integrity check failed for asar archive` 退出（exit 133）。因此打包流程必须写入 `app.asar` 的 header hash，并且要验证这一点；electron-builder 是否自动写入，没有实测。                                                     |
| `RunAsNode`、`EnableNodeOptionsEnvironmentVariable`、`EnableNodeCliInspectArguments` 等 | 与 protocol 无关，实测关闭后 `app://` 的表现不变。                                                                                                                                                                                                                                                                                                                                                                                                                |

- 其他实测事实：
  - 本机 Electron 41.0.3 官方二进制在 ad-hoc 签名下运行时，启动日志会出现一条 `Keychain lookup failed`，原因是 `EnableCookieEncryption` 要访问钥匙串。它不影响页面加载。
  - 实验没有用到 cookie。在 ad-hoc 签名的本地 `.app` 上，钥匙串授权会表现成什么样，留给打包工单确认。

## 未验证

- Vite 8.3.1 的真实构建产物（chunk、CSS、`data:` 内联、动态 import）没有实际加载过；beUI 组件是否需要 `style-src 'unsafe-inline'`。
- electron-builder 26.15.3 是否会自动写入 `ElectronAsarIntegrity`；`codeCache` 权限的收益。
- 06 实验中“报 -2 但页面仍在运行”的确切原因（原实验代码已删除）。
- `GrantFileProtocolExtraPrivileges: false` 单独作用于未打包的 `file://` 页面时的表现。
