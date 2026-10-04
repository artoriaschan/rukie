# 01: 地基 A：Agent Core → frontend 交互通道

Type: grilling
Status: resolved
Blocked by: None

## Question

Agent Core 需要向 frontend 发起一次交互并等待回复的通用机制吗？形状是什么？

现状：审批走 `onPermissionAsk` 回调。即将新增的需求：ask user（模型向用户提问、TUI 弹选项）、plan mode 批准、MCP OAuth 授权、可能的 hooks 确认。

需定：

- 统一成一个交互通道（请求种类 + 载荷 + 回复），还是每种交互各一个回调。
- 取消与超时：用户 `esc`、run 中止时挂起的交互怎么结束。
- 交互请求与回复是否进 transcript（resume 时挂起的交互如何处理）。
- Headless CLI 的统一降级规则（拒绝 / 报错 / 按默认回复）。
- 子代理验证场景：子代理内发起的交互如何转发到顶层 frontend，用户如何知道是哪个子代理在问。

## Answer

2026-10-03 grilling 结论（术语 **Interaction** 已入 `CONTEXT.md`，Headless CLI 条目同步）：

1. **形状：每种交互一个 frontend 回调**（`onPermissionAsk` 之外新增如 `onQuestion`、`onPlanApproval`、`onOAuth`），不做通用 `onInteraction` 联合体，也不做事件流 + `respond(id)`。公共部分（取消、降级、子代理转发）抽为 Agent Core 内部共享 helper，参照现有 `askPermission`。理由：各交互载荷与回复形状差异大；跨进程 frontend（server）不在本地图范围，届时在适配层把回调桥接成事件。
2. **降级：先去工具，再取安全默认值。** frontend 未提供某回调时，依赖它的模型工具不注册（如 Headless CLI 无 ask user 工具）；Agent Core 自身发起的交互取各自安全默认值：审批 → deny（现状）、plan 批准 → 拒绝并保持只读、OAuth → 报错并标记该 MCP server 不可用。不选"一律报错结束 run"（Headless 下 goal 会被一次交互打断）。
3. **取消：两级分开。** 交互内用户拒绝（TUI 审批框 `esc` 现为 deny 单个请求，保持）只结束该交互，run 继续，模型收到拒绝 / 用户不回答；run 中止经 `signal` 以取消结束所有挂起交互，frontend 借 `signal` 关闭弹窗（现状 `askPermission` `Promise.race`）。
4. **不进 transcript。** 交互结果已体现在工具结果中；进程退出即 run 中止，挂起交互按第 3 条以取消结束，resume 无悬空状态。不依赖"地基 B：工具状态进 transcript"。
5. **子代理转发：** 子代理内的交互由 Agent Core 使用顶层 session 的同一回调转发，请求附 `origin: { subagentId, description }` 供 frontend 标注来源；frontend 不为子代理单独注入回调。子代理（尤其后台子代理）是否直接走降级，由"子代理"工单决定。

## Comments

- 2026-10-04：第 2 条中"plan 批准 → 拒绝并保持只读"已被 [plan mode](10-plan-mode.md) 修订：plan 评审只由模型工具 `exit_plan_mode` 发起，无 `onPlanReview` 回调时工具不注册（先去工具）。
