# 03: 子代理的权限与交互

**What to build:** 子代理的工具调用按引用使用父 session 的判定配置：父切换 Permission Mode 时子代理立即生效；规则与会话级 allow 规则是同一个集合，子代理里的"本 session 允许"对整棵 session 树生效。子代理的 ask 和 `ask_user_question` 经父的同一回调转发，请求带 `origin { agentId, description }`，按现有 FIFO 排队。父没有 `onQuestion` 时子代理也没有 `ask_user_question`；Headless 下 ask 按 deny。TUI 审批框和提问框在有 `origin` 时，标题前显示 `子代理：<description>`（zh / en 文案）。

**Blocked by:** 02

**Status:** ready-for-agent

参考：[spec](../spec.md)「权限与交互」。

- [ ] e2e：子代理 ask 带 `origin` 到达父 `onPermissionAsk`；无回调时 deny
- [ ] e2e：子代理"本 session 允许"后，父代理的同类调用不再询问
- [ ] e2e：子代理运行中父切换 Permission Mode，子代理下一次调用立即按新模式判定
- [ ] e2e：子代理 `ask_user_question` 带 `origin`；父无 `onQuestion` 时子代理工具集里没有它
- [ ] TUI e2e：审批框和提问框显示来源
- [ ] `tsc -b` 与全量 `bun test` 通过
