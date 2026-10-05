# 01: 最小安全 web_fetch

**What to build:** 模型调用 `web_fetch { url }` 读取公网 http/https 页面的文本内容。结果第一行注明最终 URL 和状态码，接着是不可信内容声明，然后是正文，超长时截断。请求只能到公网地址，连接钉在校验过的 IP 上。工具不在免询问清单里，`ask` 模式会询问。主 session 和子代理都能用。详见 [web fetch spec](../spec.md) 的工具 schema、URL 校验、SSRF、限制、输出渲染、错误、请求头、权限（默认值部分）、hooks、子代理、测试注入点几节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 注册 `web_fetch { url }`，description 照 spec 写
- [ ] URL 校验：长度不超过 2048，只允许 http/https，不得带凭证，必须有 host
- [ ] SSRF：按 spec 的网段清单做地址分类（含 IPv4-mapped / IPv4-compatible IPv6）；IP 字面量直接判，域名的所有解析地址都要判，任一被拒即整体拒绝；被拒时不发出任何请求
- [ ] 用 per-request undici `Agent` 的 `connect.lookup` 把连接钉在校验过的地址上（处理 `{all: true}`）；从 `undici/index.js` 导入，代码注释写明 Bun stub 与全局 fetch 忽略 `dispatcher` 两个坑；确认类型能过 `tsc -b`，不能则补最小 `.d.ts`
- [ ] `undici@8.11.2` 精确锁版本并写入 `docs/tech-stack.md`
- [ ] 文本类内容（`text/*`、JSON、XML、缺失 Content-Type）以 UTF-8 返回。本票 HTML 先按文本返回，转换由 02 交付
- [ ] 限制：总超时 30 s 并与 run abort 合并；`Content-Length` 超过 5 MB 报错；流式读取到 5 MB 截断（切掉最后一块）；输出超过 50K 字符截断并附页脚
- [ ] 输出首行 `Fetched <final url> (HTTP n)` 加不可信声明；结果 `details` 记录 `{ url, status, truncated, chars }`
- [ ] 非 2xx 报工具错误并附正文前 2K 字符；各类错误有可区分的前缀
- [ ] 请求头 UA 为 `Neant/<version>`，按 spec 的 Accept，不带 cookie
- [ ] 权限默认：不在免询问清单里；`ask` 询问、`auto-review` 交审查、`full-access` 放行；PreToolUse 用 `updatedInput` 改写 URL 后仍做 SSRF 校验；hook matcher 为 `web_fetch`
- [ ] general-purpose 与 explore 子代理工具集加入 `web_fetch`
- [ ] TUI 字典加工具名（zh「网页抓取」/ en `WebFetch`），现有 `ToolCall` 显示 `web_fetch <url>` 和结果首行
- [ ] SessionOptions 测试注入点 `webFetch { resolve?, allowAddresses?, timeoutMs?, maxBytes? }`，不进 settings
- [ ] Agent Core e2e（本地 `Bun.serve` + 注入 resolve）覆盖：文本返回、首行与声明、截断、两种超限、超时、中止、404、SSRF 各类拒绝且服务器未收到请求、钉 IP 后 `Host` 头正确、请求头、ask 审批、hook 改写到私网被拒、explore 子代理可用
