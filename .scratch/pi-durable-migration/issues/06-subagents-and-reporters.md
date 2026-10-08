# 06: 后台 Subagent ownership 与持久化结果通知

Status: ready-for-agent
Blocked by: none

## What to build

用原生 background anchor task、owned Conversation 和 reporter 替换旧 Subagent 调度。保留 subagent/fork/send_message 及类型限制，恢复时复用 child、提交与通知身份。提供请求因果范围的公开完成观测供 Headless 使用，不能把普通 parent idle 改成旧“等待全部子代理”。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 默认后台 ownership，父 Run 可先结束；普通父 abort 不触及 child，显式停止所选 child 取消其活跃 ownership scope并等待原生终态。
- [ ] 子代理不允许嵌套，类型/工具/MCP 过滤、权限收窄、父级共享 Plan Mode 与 Interaction 来源转发继续有效。
- [ ] 创建和 fork 使用持久化 child/task 身份，send_message 使用稳定 requestId；重复打开或 task replay 不新增同一个逻辑 child/input。
- [ ] 子 Run 结束与 reporter 提交独立持久化；在 child done → reporter pending、通知提交 → 父处理未结算等窗口恢复，最终只逻辑投递一次且继续处理。
- [ ] close 后未结算 child 和 reporter 可恢复，显式被取消/完成的工作不因打开新建；保留 Run Outcome 与委派验收的区别，不仅看当前进程活动。
- [ ] 公开请求结算观测包含对应 child Run、reporter 与通知引发的新处理；排除空闲 background anchor、历史身份和无关工作，不用一次任务列表采样替代稳定结算。
- [ ] 子 Run 的 OS Job 与连接资源按自有资源约束清理，任务可恢复不意味着 OS 进程仍存在；来源事件和子视图只报告已提交事实。

## Testing Decisions

经 createSession+受控父子模型覆盖父先停/child后停、Esc、显式 child stop、close/reopen、fork/send_message、授权与结果窗口。可恢复逻辑通过独立进程切断及重新打开验证稳定身份；Frontends 的全请求等待在 08 验证。用 deferred model/commit predicates 同步，不轮询全局进程活跃状态推断完成。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。
