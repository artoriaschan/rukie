# 16: Electron app:// 协议的文件服务与 Origin 复核

Type: research

Blocked by: None

Status: resolved

## Question

在锁定的 Electron 41.0.3 上：`protocol.handle` 注册 standard + secure 的 `app://rukie` 并提供 Vite 构建产物的推荐方式（[06](06-research-local-server-auth.md#answer) 实验中 `loadURL` 报 `ERR_FAILED (-2)`）；WS 握手的 Origin 是否为 `app://rukie`；CSP、SPA 路由回退与 fuses（`GrantFileProtocolExtraPrivileges` 等）的配合。

## Answer

完整调研：[research/electron-app-scheme.md](../research/electron-app-scheme.md)。在 macOS arm64 上用 Electron 41.0.3 + @electron/fuses 2.0.0 实测，临时文件已删除。

- 注册：`ready` 前一次性 `registerSchemesAsPrivileged`，`app` 只开 `standard`、`secure`、`supportFetchAPI`（不开 `bypassCSP`、`corsEnabled`）；`ready` 后在窗口所用 session 上 `protocol.handle`，先于 `loadURL`。
- handler：只认 host `rukie`；`decodeURIComponent` 后用 `path.resolve` + `path.relative` 判越界（403），无扩展名路径回退 `index.html`，`net.fetch(pathToFileURL(…))` 读 `app.getAppPath()/dist`，失败 404；自行设置 `content-type`（模块脚本受严格 MIME 检查）并在 HTML 上加 CSP 头；不得抛错。
- `ERR_FAILED (-2)` 实测成因：handler 晚于 `loadURL` 注册、窗口用了未注册 handler 的 `partition`、主文档 `application/octet-stream`；handler 抛错为 `-9`，重复导航为 `-3`。按上述实现 `loadURL` 正常 resolve。06 的“报 -2 但页面运行”在 41.0.3 未复现，原代码已删除。
- Origin：WS 握手与 `fetch` 都发送 `Origin: app://rukie`（`app://RUKIE/` 也规范化为它），`Sec-Fetch-Site: cross-site`；打包并翻转 fuses 后相同。
- CSP：`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src ws://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`。端口通配避免 sidecar 重启后重载页面；实测非白名单端口被拦截、`eval` 被拦截、Vite 式 `modulepreload`/`crossorigin` 模块脚本放行。
- Fuses：`OnlyLoadAppFromAsar`、`GrantFileProtocolExtraPrivileges: false` 等全开时 `app://` 读 asar 内文件完全正常，`loadFile` 则失败，故打包后不能回退 `file://`。`EnableEmbeddedAsarIntegrityValidation` 在 Info.plist 缺 `Resources/app.asar` hash 时不校验、hash 错误时 FATAL 退出，打包流程须写入并验证该 hash。
- 未验证：真实 Vite 8.3.1 产物与 beUI 是否需要 `style-src 'unsafe-inline'`；electron-builder 26.15.3 是否自动写入 `ElectronAsarIntegrity`；`codeCache` 收益。
