# 01: 预重构：交互 helper 与 TUI Interaction 队列

**What to build:** 为 ask_user_question 让路，行为零变化。Agent Core 把现有审批的取消处理（signal 已中止立即返回、与 abort 赛跑、结束后清理监听）抽为内部通用 Interaction helper，审批改用它。TUI 把审批挂起队列（状态外置于 React）泛化为 Interaction FIFO 队列，队列项带种类，暂只有审批项；"一律允许此工具"批量放行只作用于审批项。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

参考：[spec](../spec.md) Implementation Decisions「共享 helper」「TUI 交互队列」。

- [ ] Agent Core 审批经通用交互 helper，run 中止时挂起审批仍以 deny 结束
- [ ] TUI 审批经泛化后的 Interaction 队列，并发审批逐个显示、"一律允许"批量放行行为不变
- [ ] 现有 Agent Core 与 TUI 权限相关测试全部通过，无测试被修改语义
- [ ] `tsc -b` 通过
