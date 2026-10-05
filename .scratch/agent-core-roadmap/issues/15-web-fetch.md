# 15: web fetch

Type: grilling
Status: resolved
Blocked by: 03

## Question

抓取 URL 内容给模型的工具。

需定：HTML 转 markdown 的方式（库选型或模型侧摘要）；大页面截断 / 分页；是否像 Claude Code 那样用小模型按 prompt 提炼；权限默认（读操作但会外发请求，Permission Mode 下归哪类，是否支持域名规则，依赖权限规则工单的语法）；重定向与私有网段（SSRF）限制。

## Answer

2026-10-05 grilling 结论。参考：deepseek-harness `packages/web/{tool-web,web-fetch-http}`（主参考）、Claude Code `WebFetchTool`（fork，默认走 Tavily）、opencode `webfetch`；Codex 无客户端 fetch 工具。

1. **schema：** `web_fetch { url }`，不提供 `prompt` 参数，也不用小模型提炼（会多一次调用和一项配置，摘要会丢代码细节、还可能编造；大文档交给 explore 子代理读）。输出上限 50K 字符，超出截断，结尾提示模型换更具体的 URL。
2. **转换：** HTML 用 `turndown` + `@joplin/turndown-plugin-gfm` 转 markdown，去掉 script、style、iframe 和隐藏元素。`text/*`、JSON、XML 按 charset 原样返回。其他类型（PDF、图片、二进制）报 unsupported content type。新依赖精确锁定版本并写入 `docs/tech-stack.md`。
3. **限制：** 响应最大 5 MB（`Content-Length` 超出直接拒绝；流式读取超出则截断并标记，最后一块需手动切）；超时 30 s；URL 最长 2048；不做跨调用缓存。
4. **权限：** 不进免询问清单：`ask` 模式询问、`auto-review` 交审查、`full-access` 放行。规则语法扩展为 `web_fetch(domain:example.com)`，支持子域通配 `*.example.com`，也支持裸名 `web_fetch`。「本 session 允许」生成该域名的规则。不做预批准域名清单（要维护，且写进 URL 的数据会被外带而无人察觉）。
5. **重定向：** 手动处理。同源（scheme、host、port 都相同）最多跟 5 跳，每跳重新做 SSRF 校验。跨源不跟随，作为正常结果返回 `Redirected to <url>; call web_fetch again with it`，模型重新调用时对新域名再走一遍权限检查。不自动把 http 升级为 https。
6. **SSRF：** 照 DSH：
   - 只接受 http/https，URL 里带账号密码的拒绝。
   - DNS 解析出的每个地址都必须是公网单播，否则拒绝。拒绝范围包括 loopback、私有网段、link-local、CGNAT、multicast、IPv4-mapped IPv6；直接写 IP 的 URL 同样校验。
   - 用 undici `Agent` 的 `connect.lookup` 把连接钉在校验过的地址上，防 DNS rebinding。
   - 私网地址一律拒绝，不提供放开的开关。

   实测（Bun 1.4.2 + `undici@8.11.2`）：
   - 必须从 `undici/index.js` 导入。裸 `'undici'` 会被 Bun 换成内置 stub，该 stub 忽略 lookup。
   - Bun 全局 `fetch` 忽略 `dispatcher`，必须用 undici 的 `fetch`。
   - `lookup` 会收到 `{all: true}`，返回值要按地址数组处理。
   - TLS 证书仍按 hostname 校验。
   - `undici/index.js` 的类型能否通过 `tsc` 解析未验证，实现时确认。

   新依赖锁定 `undici@8.11.2`，写入 tech-stack，并在代码注释说明这个 Bun 坑。

7. **请求头与输出：** UA 为 `Neant/<version>`，Accept 为 `text/markdown, text/html;q=0.9, */*;q=0.8`，不带 cookie 和凭证。结果第一行 `Fetched <final url> (HTTP n)`，接着一行不可信内容声明（照 DSH `trust.ts`），然后是正文。非 2xx 报工具错误，附正文前 2K 字符。
8. **代理：** 读 `HTTP(S)_PROXY` / `NO_PROXY`，用 undici 的 `EnvHttpProxyAgent`。走代理时跳过 DNS 校验与 IP 钉定，但写成私网 IP 的 URL 仍然拒绝。不新增代理配置。
9. **子代理、hooks 与 Headless：** general-purpose 和 explore 子代理都可用，权限按引用共享父 session 配置。hooks 的 matcher 写 `web_fetch`，不加新事件。Headless 无审批回调，默认 deny；需要时用 `--allow-tools 'web_fetch(domain:…)'` 或 `full-access` 放行。
10. **TUI：** 复刻 dsh-TUI 的通用工具卡，不做 web_fetch 专属卡。整体升级另开工单 [TUI 工具卡复刻 dsh-TUI](20-tui-tool-card.md)。web_fetch 只需提供 URL 作标题、结果正文，以及 `web` 类别（mist blue 状态点）。通用卡升级完成前，沿用现有 `ToolCall` 显示 `web_fetch <url>` 和第一行结果。

Spec：[web fetch spec](../../web-fetch/spec.md)（ready-for-agent）。
