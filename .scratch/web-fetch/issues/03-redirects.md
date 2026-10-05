# 03: 重定向

**What to build:** 同站内的重定向（如 `/docs` → `/docs/`）自动跟随，结果首行显示最终 URL。跳到其他站点时不跟随，告诉模型新地址，让它重新调用；再次调用时新域名要重新过权限。详见 [web fetch spec](../spec.md) 的"重定向"一节。

**Blocked by:** 01 最小安全 web_fetch

**Status:** ready-for-agent

- [ ] 使用 `redirect: "manual"`，`Location` 按当前 URL 解析为绝对地址
- [ ] 同源（scheme、host、port 相同）跟随，最多 5 跳，每跳重新做 URL 校验与 SSRF 校验；超过 5 跳报工具错误
- [ ] 跨源返回成功结果 `Redirected to <url>; call web_fetch again with it to continue.`（附原状态码），不发请求到新站
- [ ] 不自动把 http 升级为 https
- [ ] 总超时覆盖整个重定向链
- [ ] e2e 覆盖：同源跟随后首行为最终 URL；第 6 跳报错；跨源时 `other.test` 未收到请求；同源跳到私网地址时被拒；`ask` 模式下用新 URL 再调用会重新询问
