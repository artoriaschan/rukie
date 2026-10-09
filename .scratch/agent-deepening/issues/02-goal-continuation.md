# 02: Goal 续跑归 tools/goal

**What to build:** 激活校验、driver 任务创建与中止、轮次计数、wrap-up 与激活清理移入 `tools/goal`；Session 在 `rukie.session` hook 的固定位置调用 Goal 接口并提供 submit/settle adapter。详见 [spec](../spec.md)。

Blocked by: 01

Status: ready-for-agent

- [ ] Session 不再直接读写 `GoalActivationDoc` 或解析轮次
- [ ] `tests/tools/goal/` 在假 harness 上覆盖轮次、wrap-up 与撤销
- [ ] goal、goal-tools、goal-recovery e2e 保留代表性用例并通过
