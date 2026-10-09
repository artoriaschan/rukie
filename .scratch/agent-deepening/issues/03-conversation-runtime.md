# 03: Conversation Runtime

**What to build:** `session/conversation/` 工厂为 root 与 child Conversation 装配 permission gate、hook 运行器、jobs、file tracking 与 `beforeTool`/`afterTool`；`forkAt` 与子代理模型选择移入 `tools/subagents/controller`。详见 [spec](../spec.md)。

Blocked by: 01

Status: ready-for-agent

- [ ] root 与 child 共用一份工具策略序列实现
- [ ] Session 不再导入 `tools/subagents/state.ts`
- [ ] `tests/session/conversation/` 覆盖阶段顺序与 child origin
- [ ] subagent-permissions、subagent-hooks、permission-* e2e 通过
