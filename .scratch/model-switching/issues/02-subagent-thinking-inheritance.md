# 02: 子 agent 继承 Thinking Level

Status: resolved

Blocked by: 01

**What to build:** 新建的非 fork、非 retained 子 agent：继承模型时也继承父 Session 当前的 `thinkingLevel`；显式指定模型（类型 `model` 或 `subagentModel`）时，按它的模型对 `settings.thinking` 降级。fork 与 retained 的行为不变。见 spec「Agent Core」子 agent 部分。

- [x] e2e：父 Session 切换档位后新建继承型子 agent，它的首次请求带父 Session 的当前档位
- [x] e2e：显式指定模型的子 agent 使用 `settings.thinking`，并按它的模型降级
- [x] retained 子 agent 恢复时仍用自己保存的选择

## Comments

- 实现：新建非 fork、非 retained 且继承模型的子代理从父原生 Agent document 读取当前 Thinking Level；显式类型模型或 `subagentModel` 使用 `settings.thinking`，经共享 `supportedThinkingLevel` 向下降档。保留 fork 配置路径与 retained Agent document 恢复覆盖。
- TDD：继承请求先红（父 `high`、子仍 `low`），显式模型请求先红（settings `medium` 未降档），修复后两者通过。冷 resume + `send_message` 证明 retained 子代理保存的 `high` 不被父当前 `low` 或新 settings `medium` 覆盖。
- 验证：`bun test packages/agent/tests/e2e/subagent-types.test.ts packages/agent/tests/e2e/subagent-fork.test.ts packages/agent/tests/e2e/subagent-directory.test.ts packages/agent/tests/e2e/model-selection.test.ts`：41 pass、0 fail，10.46s；新增继承 168ms、retained 561ms，显式模型路径 173–511ms。没有固定等待或真实凭据。fork 既有测试使用支持 reasoning 的 faux fixture，继续断言其原有 `low` 配置；非 reasoning 的父 Session 在票 01 已规范化为 `off`。
- 静态检查：`bun run check:dev`、`bunx --no -- tsc -b`、`bun run check:docs` 通过；最终全量 `check` 由 integration branch 统一执行一次。
- 文档：更新 Agent Core README 的子代理 Model Selection 规则。ADR coverage 沿用 spec 的 ADR-0024 原生 Agent document 恢复来源与 ADR-0009 的子代理身份/Run Outcome 约束；档位来源与降档属于局部配置规则，无新长期架构取舍。
