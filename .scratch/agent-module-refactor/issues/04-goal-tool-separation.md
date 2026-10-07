Status: resolved
Blocked by: [03](03-tool-ownership-migration.md)

# 04：Goal 能力聚合与内部协议分离

## What to build

将完整 Goal 能力迁至 tools/goal/，在同一目录内区分 controller、state 与 tool。create_goal/update_goal 的声明、输入校验与模型结果包装归 tool，controller 保留状态和续跑规则。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

packages/agent/src/goal/ 迁至 tools/goal/，内部按 controller.ts、state.ts、tool.ts 分工；更新 Session、包导出与全部消费者。

## Acceptance Criteria

- [x] 工具名称、label、description、schema、参数错误码、JSON结果内容与 details 保持当前协议。
- [x] directHuman/goalRound 判断与对现有 controller 的调用时机不变，目标状态和授权的不变量仍由拥有它们的模块执行。
- [x] Goal controller 保留 create/edit/pause/resume/finish、持久化、armed 与续跑规则，顶层专属状态与工具保持。
- [x] Goal round/wrapup 上下文属于续跑能力并继续由 Goal 生成；工具调用现有动作，不把它错误地移为另一份工具状态。
- [x] 协议适配复用工具运行支持；同目录的 controller 不反向依赖 tool 或全局工具组装入口，能力 index.ts 对 Session 提供直接执行接口。
- [x] 删除顶层 goal/ 的旧归属与废弃转导出，保留包公开 GoalView 和 Session Goal 接口。
- [x] 更新 Session 消费、包导出和相关当前文档，删除旧工具实现及转导出。

## Verification

01 协议基线，goal-tools、Goal continuation、恢复、Subagent/Goal 隔离、权限与 Headless Goal 的现有公开套件。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

核对模型结果结构与现有错误码，记录正常完成、暂停/恢复、受阻和内部续跑触发的实际检查结果。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
- 2026-10-07：实施完成（`106062c`，集成 `0c5dc22`，父提交 `f96cd9d`）。因实施时未追加证据评论，本条由票 08 在集成点 `ba200b7` 逐条复核后补记；所有命令均在票 08 worktree 实际运行。

  搬迁按块逐字节核对，不是"看起来等价"。用 `git show 5c730be:packages/agent/src/goal/index.ts` 切出两个区间，与 `ba200b7` 的新文件同区间 `diff`：controller 区间（`/** DSH goal-round-driver/` 到 `return controller;`）与 tool 区间（`/** Guidance adapted from DSH tool-goal` 到 `return [preserveErrorDetails(create), preserveErrorDetails(update)];`）各 127 行，`diff` 输出为空。因此：

  - `tools/goal/controller.ts`（blob `d73ae45e…`）= 原 `goal/index.ts` 的 controller 区间逐字 + 顶部改为 `import { goalSchema, type GoalSnapshot, type GoalView } from "./state.ts"`，`renderWrapupContext` 由模块内函数改为导出函数。
  - `tools/goal/tool.ts`（blob `c25f900c…`）= 原 `goal/index.ts` 的 tool 区间逐字（`guidance` 文案、`createParameters`/`updateParameters` schema、`argumentError` 的 `goal-tool-invalid-argument`/`goal-tool-required-argument` 错误码、`requireHuman`、`result()` 的 JSON content 与 details、`execution.directHuman()/goalRound()` 判断顺序），仅新增 `import { renderWrapupContext, type createGoalController } from "./controller.ts"` 与 `import { preserveErrorDetails } from "../runtime.ts"`。
  - `tools/goal/state.ts`（blob `2982372a…`）= 原 `goal/index.ts` 的 `goalSchema`、`GoalSnapshot`、`GoalView`、`goalState`（版本 1 严格解析与提醒）逐字，导入路径改为 `../../tool-state/index.ts`。
  - `tools/goal/index.ts` 提供 `createGoalController`、`renderGoalRoundPrompt`（controller）、`goalState`、`GoalView`（state）、`createGoalTools`（tool）；`renderWrapupContext` 只在同目录 `tool.ts` 使用，不由能力入口转导出。

  AC 4 的关键区分：round 提示与收尾上下文仍由 Goal 生成，且**收尾文本是 user 消息，不是工具结果**——`tools/goal/tool.ts:128` 在 `update_goal` 成功后调用 `execution.wrapup(renderWrapupContext(...))`，Session 侧 `session/index.ts` 的实现构造 `{ role: "user", content: [{type:"text", text}], timestamp, source: "goal" }` 后 `agent.steer(message)`；`renderGoalRoundPrompt` 由 `session/index.ts:2667` 在自动续跑时作为 `source: "goal"` 的 round 消息投递。两者都不经过 `AgentToolResult` 包装。AC 5：controller 只导入 `@neant/shared`、`typebox/value` 与 `./state.ts`，不导入 `./tool.ts`，也不导入 `tools/builtin.ts` 或 `session/tools.ts`；`tool.ts` 复用 `tools/runtime.ts` 的 `preserveErrorDetails`，与原实现一致（原 `goal/index.ts` 也从 `../tools/index.ts` 导入同一函数）。

  AC 6/7：`packages/agent/src/goal/` 由 `106062c` 删除（`git log --diff-filter=D`）；包导出 `packages/agent/src/index.ts:39` 的 `export type { GoalView } from "./goal/index.ts"` 改为 `"./tools/goal/index.ts"`，导出名与类型不变（导出名集合与 `5c730be` 逐一相同）；Session 消费改为 `import { createGoalController, goalState, renderGoalRoundPrompt, type GoalView } from "../tools/goal/index.ts"`（`session/index.ts`），行为由 `goal-tools.test.ts`、`goal.test.ts` 保护。

  命令与结果（worktree `agent-module-refactor-08`，`ba200b7`）：
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/goal-tools.test.ts packages/agent/tests/e2e/goal.test.ts packages/agent/tests/e2e/session-recovery.test.ts packages/agent/tests/e2e/subagents.test.ts packages/agent/tests/e2e/subagent-permissions.test.ts packages/agent/tests/e2e/permission-rules.test.ts apps/neant-cli/tests/main.test.ts apps/neant-tui/tests/screens/chat/goal.test.ts apps/neant-tui/tests/screens/chat/goal-tool-cards.test.ts` → 157 pass / 0 fail，9 文件，738 expect，exit 0。
  - `git diff 5c730be..ba200b7 -- packages/agent/tests/e2e/goal-tools.test.ts packages/agent/tests/e2e/goal.test.ts apps/neant-cli/tests apps/neant-tui/tests/screens/chat/goal.test.ts apps/neant-tui/tests/screens/chat/goal-tool-cards.test.ts` → 空（相关公开套件断言未改）。
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/tool-declarations.test.ts` → 10 pass / 0 fail（`create_goal`/`update_goal` 的 description 与完整 parameters 由 `5c730be` 上冻结的字面量基线覆盖）。

  未能验证/限制：
  - 本票没有留下自己的实施证据评论，也没有记录"正常完成、暂停/恢复、受阻和内部续跑触发"的逐场景实际输出。票 08 只能给出上表套件通过 + 代码逐字未变；没有逐场景的模型结果快照，那些场景由既有套件覆盖而非本票独立区分。
  - "相关当前文档"在本票没有可归因的改动：`docs/architecture.md` 的 `goal/` 行由票 07（`340aa1a`）改为 `tools/goal/`。最终状态正确，但本票当时的文档同步范围不可恢复。
  - 未运行 `bun run check` 聚合检查（按 Spec 留给票 08）。
