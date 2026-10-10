# 02: 子 agent 继承 Thinking Level

Status: ready-for-agent

Blocked by: 01

**What to build:** 新建的非 fork、非 retained 子 agent：继承模型时也继承父 Session 当前的 `thinkingLevel`；显式指定模型（类型 `model` 或 `subagentModel`）时，按它的模型对 `settings.thinking` 降级。fork 与 retained 的行为不变。见 spec「Agent Core」子 agent 部分。

- [ ] e2e：父 Session 切换档位后新建继承型子 agent，它的首次请求带父 Session 的当前档位
- [ ] e2e：显式指定模型的子 agent 使用 `settings.thinking`，并按它的模型降级
- [ ] retained 子 agent 恢复时仍用自己保存的选择
