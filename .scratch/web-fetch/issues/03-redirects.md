# 03: 重定向

**What to build:** 同站内的重定向（如 `/docs` → `/docs/`）自动跟随，结果首行显示最终 URL。跳到其他站点时不跟随，告诉模型新地址，让它重新调用；再次调用时新域名要重新过权限。详见 [web fetch spec](../spec.md) 的"重定向"一节。

Blocked by: 01 最小安全 web_fetch

Status: resolved

- [x] 使用 `redirect: "manual"`，`Location` 按当前 URL 解析为绝对地址
- [x] 同源（scheme、host、port 相同）跟随，最多 5 跳，每跳重新做 URL 校验与 SSRF 校验；超过 5 跳报工具错误
- [x] 跨源返回成功结果 `Redirected to <url>; call web_fetch again with it to continue.`（附原状态码），不发请求到新站
- [x] 不自动把 http 升级为 https
- [x] 总超时覆盖整个重定向链
- [x] e2e 覆盖：同源跟随后首行为最终 URL；第 6 跳报错；跨源时 `other.test` 未收到请求；同源跳到私网地址时被拒；`ask` 模式下用新 URL 再调用会重新询问

## Comments

### 2026-10-05 implementation and verification

- 分支 `codex/web-fetch-03` 开始前合并集成基线 `9b5612e`。请求继续使用已有 manual redirect；编排模块逐跳校验 URL 与 DNS，并在下一跳前取消当前响应、销毁该请求的 dispatcher。整链复用原超时及 Run 取消信号。
- 跨源主机、端口、协议变化返回成功工具结果，保留原 URL 与 HTTP 状态、新绝对 URL，并要求重新调用；http→https 也交回模型。第 6 次同源跳转报 `Too many redirects:`。非法 Location 报 `Invalid URL:`。
- 公开测试入口为已批准的 `createSession` + `fakeModel` + 本地 HTTP 服务；先确认同源跳转、跳数上限、跨源结果、非法 Location 回归失败，再逐项实现。额外覆盖重定向正文永不结束的取消、同源第二次 DNS 改为私网的拒绝、整链总超时，以及新域名重新审批。
- `rtk proxy bun test packages/agent/tests/e2e/web-fetch-redirects.test.ts packages/agent/tests/e2e/web-fetch.test.ts`：65 pass、0 fail，167 assertions；本票新增 14 个用例。`rtk proxy bunx --no -- oxfmt --check`、`oxlint`、`tsc -b`、`knip` 全部 exit 0。集成分支最终 aggregate check 由集成流程统一运行并记录。

### 最终集成验证

实现及审查修复已合入 `codex/web-fetch-integration`；全量检查与双轴复核证据见 [Spec Delivery](../spec.md#delivery)。
