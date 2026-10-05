# 01: 最小安全 web_fetch

**What to build:** 模型调用 `web_fetch { url }` 读取公网 http/https 页面的文本内容。结果第一行注明最终 URL 和状态码，接着是不可信内容声明，然后是正文，超长时截断。请求只能到公网地址，连接钉在校验过的 IP 上。工具不在免询问清单里，`ask` 模式会询问。主 session 和子代理都能用。详见 [web fetch spec](../spec.md) 的工具 schema、URL 校验、SSRF、限制、输出渲染、错误、请求头、权限（默认值部分）、hooks、子代理、测试注入点几节。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 注册 `web_fetch { url }`，description 照 spec 写
- [x] URL 校验：长度不超过 2048，只允许 http/https，不得带凭证，必须有 host
- [x] SSRF：按 spec 的网段清单做地址分类（含 IPv4-mapped / IPv4-compatible IPv6）；IP 字面量直接判，域名的所有解析地址都要判，任一被拒即整体拒绝；被拒时不发出任何请求
- [x] 用 per-request undici `Agent` 的 `connect.lookup` 把连接钉在校验过的地址上（处理 `{all: true}`）；从 `undici/index.js` 导入，代码注释写明 Bun stub 与全局 fetch 忽略 `dispatcher` 两个坑；确认类型能过 `tsc -b`，不能则补最小 `.d.ts`
- [x] `undici@8.11.2` 精确锁版本并写入 `docs/tech-stack.md`
- [x] 文本类内容（`text/*`、JSON、XML、缺失 Content-Type）以 UTF-8 返回。本票 HTML 先按文本返回，转换由 02 交付
- [x] 限制：总超时 30 s 并与 run abort 合并；`Content-Length` 超过 5 MB 报错；流式读取到 5 MB 截断（切掉最后一块）；输出超过 50K 字符截断并附页脚
- [x] 输出首行 `Fetched <final url> (HTTP n)` 加不可信声明；结果 `details` 记录 `{ url, status, truncated, chars }`
- [x] 非 2xx 报工具错误并附正文前 2K 字符；各类错误有可区分的前缀
- [x] 请求头 UA 为 `Neant/<version>`，按 spec 的 Accept，不带 cookie
- [x] 权限默认：不在免询问清单里；`ask` 询问、`auto-review` 交审查、`full-access` 放行；PreToolUse 用 `updatedInput` 改写 URL 后仍做 SSRF 校验；hook matcher 为 `web_fetch`
- [x] general-purpose 与 explore 子代理工具集加入 `web_fetch`
- [x] TUI 字典加工具名（zh「网页抓取」/ en `WebFetch`），现有 `ToolCall` 显示 `web_fetch <url>` 和结果首行
- [x] SessionOptions 测试注入点 `webFetch { resolve?, allowAddresses?, timeoutMs?, maxBytes? }`，不进 settings
- [x] Agent Core e2e（本地 `Bun.serve` + 注入 resolve）覆盖：文本返回、首行与声明、截断、两种超限、超时、中止、404、SSRF 各类拒绝且服务器未收到请求、钉 IP 后 `Host` 头正确、请求头、ask 审批、hook 改写到私网被拒、explore 子代理可用

## Comments

### 2026-10-05 implementation

- 在 `codex/web-fetch-01` 实现本票；从 `codex/web-fetch-integration` 建分支并用 `git merge-base --is-ancestor` 验证基线。
- 新模块 `packages/agent/src/web-fetch/{addresses,http,content,index}.ts` 分别拥有 URL/DNS 校验、钉 IP 请求、文本解码/输出和生命周期；HTML 转换、重定向、代理分别由 02、03、05 后续票交付。本票不自动跟随重定向。
- `undici@8.11.2` 的 `undici/index.js` 在 Bun 可用且现有类型可直接通过 `tsc -b`；无须 `.d.ts` shim。取消已读/未读正文后销毁每请求 Agent，读取正文显式与合并 abort signal 竞争，覆盖 Bun 下 stalled reader 不随 fetch signal 释放的问题。
- agent 原无 version 字段；新增私有包 `version: 0.0.0`，UA 从该字段生成，tsconfig 纳入 package.json。生产配置无测试豁免入口；SessionOptions 的注入随父配置传给子 Session。
- RED：首个 `createSession` 公共测试返回工具不存在，TUI 60/120 列的 URL 摘要测试最初返回 JSON 摘要；实现后通过。地址分类覆盖 IPv4、IPv6、映射/兼容写法、文档/benchmark/保留网段和混合 DNS；所有测试目标均本地服务或拒绝地址。
- 已运行 focused Core/TUI/subagent checks：69 pass，0 fail（包含 48 Core、4 TUI、17 subagent 类型用例）；CLI stream-json metadata 单测：1 pass，0 fail。新增保留网段用例随后纳入最终检查。
- 初次完整 `rtk proxy env -u NO_COLOR bun run check`：1762 pass，1 fail；唯一失败是 CLI `session_start.tools` 预期未包含新增工具，已修复并通过 focused 回归。最终完整检查正在运行；完成后追加结果并关闭本票。

### 2026-10-05 final verification

- 最终 `rtk proxy env -u NO_COLOR bun run check` 全部通过：format、lint、types、Knip、1768 tests pass，0 fail，9189 assertions，136 files，exit 0。日志：`/tmp/neant-web-fetch-01-final-check.log`。
- 交付提交 `d5a769d`；完成前已把当前 `codex/web-fetch-integration` tip 合并回本票分支。`rtk git diff --check` 无错误。本票已关闭；02/03/04/05 的后续范围仍由其票跟踪。

### 2026-10-05 integration review fixes

- Spec 审阅修复：HTTP 非 2xx 附文与成功结果共用 content 模块的不可信内容声明，保留 `HTTP <status> from <url>` 首行与转换后正文前 2K 字符。模型工具为成功、跨源重定向与执行错误的 `details` 添加 `category: "web"`，保留 Run 取消异常及既有 Hook 的成功/失败处理。
- Session 公共回归先确认 HTTP 错误附文缺少声明、成功/错误缺少类别，再验证修复；跨源重定向类别也通过公开结果验证。HTML 与文本测试共用同包 `tests/helpers/web-fetch.ts` 的 Session、服务器及资源清理 fixture，场景与断言保留。
- focused Core/TUI/Headless 8 文件在无效外部代理环境下通过：218 pass / 0 fail，870 assertions；随后新增大型简单 HTML 用例并重跑 Core 三文件：80 pass / 0 fail，228 assertions。最终格式、lint、types、Knip、diff whitespace 检查通过。最终集成检查由 integration 分支统一验收。

### 最终集成验证

实现及审查修复已合入 `codex/web-fetch-integration`；全量检查与双轴复核证据见 [Spec Delivery](../spec.md#delivery)。
