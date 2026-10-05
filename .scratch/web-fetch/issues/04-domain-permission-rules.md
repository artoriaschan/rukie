# 04: 域名权限规则

**What to build:** 用户可以写 `web_fetch(domain:docs.python.org)` / `web_fetch(domain:*.example.com)` 规则，长期允许、询问或禁止某些站点。审批时选「本 session 允许」，同域名其他页面不再询问。Headless 下默认 deny，可以用 `--allow-tools 'web_fetch(domain:…)'` 放行。详见 [web fetch spec](../spec.md) 的"权限"和"Headless"两节。

**Blocked by:** 01 最小安全 web_fetch

**Status:** resolved

- [x] 规则解析支持 `web_fetch(domain:<host>)`、`web_fetch(domain:*.<suffix>)` 和裸名 `web_fetch`；其他 specifier 报错
- [x] 匹配规则：不区分大小写，去掉结尾的点；`*.b` 只匹配子域，不匹配 `b` 本身
- [x] allow / ask / deny 与 Permission Mode 的组合沿用现有语义：deny 在 full-access 下仍拒绝，ask 在 full-access 下仍询问
- [x] 项目层 allow 仅在 Trusted Project 生效（沿用现状）
- [x] 「本 session 允许」生成 `web_fetch(domain:<当前 host>)` 的内存规则
- [x] 规则判定使用 hook 改写后的 URL
- [x] 子代理共享父规则，审批经顶层转发
- [x] 规则解析单测覆盖以上语法与边界
- [x] e2e 覆盖：allow 免询问、通配匹配、deny 在 full-access 下仍拒绝、session allow 按域名生效（同域其他路径免询问，其他域名仍询问）
- [x] CLI e2e：无规则时 deny；`--allow-tools 'web_fetch(domain:site.test)'` 放行（测试注入点经 CLI 测试 io 传入）

## Answer

权限规则新增精确域名与子域通配；大小写、结尾点和 IPv6 主机写法归一化，保留原始规则用于反馈。本 Session 授权按域名存于共享内存，URL 无法解析时不会生成全工具授权。CLI 沿用现有测试 io 的 SessionOptions 注入；TUI 使用域名授权文案，zh/en 同步，40×12 与 80×24 均验证可操作。文档见 docs/permission-rules.md。

## Comments

- 基于集成分支 9b5612e 开始，交付前同步 2f52203（工单 03 重定向）。
- TDD：新增规则测试先得到 8 个非法规则失败，再加入解析和匹配；Session 授权测试先观察到全工具授权，再改为域名授权；IPv6 主机归一化也先复现匹配失败。
- 验证：`env -u NO_COLOR bun test packages/agent/tests/permissions packages/agent/tests/e2e/permission-rules.test.ts packages/agent/tests/e2e/subagent-permissions.test.ts packages/agent/tests/e2e/web-fetch-permissions.test.ts apps/neant-cli/tests/e2e/cli.test.ts apps/neant-tui/tests/components/permission-dialog/permission-dialog.test.tsx apps/neant-tui/tests/e2e/permissions.test.ts` 通过 253 个测试；随后 IPv6 规则新增测试通过。
- 格式、oxlint、tsc -b、Knip 均通过；全部通过的最终集成检查由集成分支记录。初次组合测试未清除 NO_COLOR 导致现有终端颜色断言失败，按仓库要求清除后通过。
