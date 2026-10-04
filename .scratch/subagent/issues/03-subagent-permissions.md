# 03: 子代理的权限与交互

**What to build:** 子代理的工具调用按引用使用父 session 的判定配置：父切换 Permission Mode 时子代理立即生效；规则与会话级 allow 规则是同一个集合，子代理里的"本 session 允许"对整棵 session 树生效。子代理的 ask 和 `ask_user_question` 经父的同一回调转发，请求带 `origin { agentId, description }`，按现有 FIFO 排队。父没有 `onQuestion` 时子代理也没有 `ask_user_question`；Headless 下 ask 按 deny。TUI 审批框和提问框在有 `origin` 时，标题前显示 `子代理：<description>`（zh / en 文案）。

**Blocked by:** 02

**Status:** resolved

参考：[spec](../spec.md)「权限与交互」。

- [x] e2e：子代理 ask 带 `origin` 到达父 `onPermissionAsk`；无回调时 deny
- [x] e2e：子代理"本 session 允许"后，父代理的同类调用不再询问
- [x] e2e：子代理运行中父切换 Permission Mode，子代理下一次调用立即按新模式判定
- [x] e2e：子代理 `ask_user_question` 带 `origin`；父无 `onQuestion` 时子代理工具集里没有它
- [x] TUI e2e：审批框和提问框显示来源
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

- 2026-10-04：实现已验证，状态保持 claimed，等待 Standards / Spec 独立审查。
  - Agent Core 的子 session 共用父 Permission Mode getter、静态规则、会话 allow 规则和 grant 通知集合；一处 session grant 会撤回整棵树中匹配的待审批请求。
  - PermissionAskRequest / QuestionRequest 统一为可选 `origin { agentId, description }`，子代理经父回调转发；Headless 保持 deny 且不注册 question 工具。
  - TUI 的审批 / 提问标题显示中英文子代理来源，标题占用原有一行。
  - 公开接缝新增 6 个 Agent e2e 与 4 个 TUI e2e；初始 grant / 待审批跨 session grant / 来源标题均观察到 red 后 green。
  - `env -u NO_COLOR bun run check` exit 0：1013 pass / 0 fail / 5500 assertions，75 files（113.09s）。日志：`/tmp/neant-ticket03-check.log`。

## Answer

实现提交：`1a6670b`。父子 session 以引用共享权限判定配置和会话授权通知；子代理权限审批与 question 复用父回调并携带来源。Headless 行为保持安全默认值，TUI 来源标题覆盖 zh / en。

### Standards

独立 reviewer `/root/review03_standards`：0 actionable findings。固定审查基点 `f16ea9e2253ae925f8b6ef3abe36f230e50af7cd` 已验证，diff 非空。

### Spec

协调者独立 Spec 审查：0 findings。权限配置引用、mode / grants 共享、跨 session pending ask 撤回、origin、Headless 和 zh / en 来源标题均满足本工单。

审查汇总：Standards 0 findings；Spec 0 findings。两轴均无待处理问题。

验证沿用实现提交的 `env -u NO_COLOR bun run check`：exit 0，1013 pass / 0 fail / 5500 assertions / 75 files。本次收尾只改本工单文档，不重跑全量测试；主分支集成与 worktree 移除由协调者处理。
