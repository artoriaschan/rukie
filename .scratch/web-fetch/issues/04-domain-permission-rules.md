# 04: 域名权限规则

**What to build:** 用户可以写 `web_fetch(domain:docs.python.org)` / `web_fetch(domain:*.example.com)` 规则，长期允许、询问或禁止某些站点。审批时选「本 session 允许」，同域名其他页面不再询问。Headless 下默认 deny，可以用 `--allow-tools 'web_fetch(domain:…)'` 放行。详见 [web fetch spec](../spec.md) 的"权限"和"Headless"两节。

**Blocked by:** 01 最小安全 web_fetch

**Status:** ready-for-agent

- [ ] 规则解析支持 `web_fetch(domain:<host>)`、`web_fetch(domain:*.<suffix>)` 和裸名 `web_fetch`；其他 specifier 报错
- [ ] 匹配规则：不区分大小写，去掉结尾的点；`*.b` 只匹配子域，不匹配 `b` 本身
- [ ] allow / ask / deny 与 Permission Mode 的组合沿用现有语义：deny 在 full-access 下仍拒绝，ask 在 full-access 下仍询问
- [ ] 项目层 allow 仅在 Trusted Project 生效（沿用现状）
- [ ] 「本 session 允许」生成 `web_fetch(domain:<当前 host>)` 的内存规则
- [ ] 规则判定使用 hook 改写后的 URL
- [ ] 子代理共享父规则，审批经顶层转发
- [ ] 规则解析单测覆盖以上语法与边界
- [ ] e2e 覆盖：allow 免询问、通配匹配、deny 在 full-access 下仍拒绝、session allow 按域名生效（同域其他路径免询问，其他域名仍询问）
- [ ] CLI e2e：无规则时 deny；`--allow-tools 'web_fetch(domain:site.test)'` 放行（测试注入点经 CLI 测试 io 传入）
