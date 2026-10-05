# 02: 模型 goal 工具与收尾

**What to build:** 模型可以用 `create_goal` 根据用户的长任务请求替用户设 goal，也可以用 `update_goal` 修改、暂停、恢复 goal，或在完成时标记 complete、卡住时标记 blocked。在 goal round 内标记 complete / blocked 后，模型会在同一 run 里给用户写一段收尾说明。TUI 中这两个工具的卡片显示 goal 摘要，而不是原始 JSON。详见 [Goal spec](../spec.md) 的"模型工具"和"TUI 工具卡"两节。

**Blocked by:** 01 Goal 续跑核心

**Status:** resolved

- [x] 仅顶层 session 注册 `create_goal { objective, max_goal_rounds? }` 与 `update_goal { action, objective?, blocked_reason? }`（Headless 也注册），不提供 `get_goal`
- [x] 授权：create / edit / pause / resume 需当前 run 有直接人类输入（prompt 或 steer）；模型 resume 一个 paused 的 goal 时拒绝；complete / blocked 在直接人类输入或当前 goal round 内都可以
- [x] run 中用户 pause 后，模型 complete 被接受，complete 覆盖 paused
- [x] 参数组合校验：`objective` 仅 edit 有效；`blocked_reason` 仅 blocked 有效且必填；错误组合返回工具错误
- [x] `create_goal` 不另起 run，当前 run 结束后由 driver 接手
- [x] goal round 内 complete / blocked 成功后，追加带 goal 来源标记的收尾 user 消息（照搬 DSH `renderWrapupContext` 原文）；complete / blocked 都 disarm，不再开轮
- [x] 工具结果为紧凑 JSON `{ goal: {...} | null, armed }`；工具 description 承载使用规范（照 DSH guidance 改写），不改 System Prompt
- [x] TUI 工具卡渲染三行：`🎯 objective`、`<label> · n/max · armed|disarmed`，blocked 时加 `⛔ reason`；出错时按现有错误卡呈现
- [x] Agent Core e2e 覆盖授权、参数校验、complete / blocked 收尾、上限；TUI 测试覆盖工具卡

## Answer

Implemented model Goal controls in `packages/agent/src/goal/index.ts`, wired only into top-level Sessions, including Headless. Controls use the existing serialized Goal mutations and permission gate. The current Run owns human-input/Goal-round authority; historical prompts and internal steering do not grant human authority. Model resume checks the paused phase inside the serialized mutation, so a concurrent human pause cannot be reversed. Completing or blocking an automatic round queues the verbatim DSH wrapup as a `source: "goal"` user message in that same Run and disarms continuation.

Results use the specified compact JSON. Known tool errors retain typed code/parameters in persisted results and render in zh/en. TUI live and replay tool cards show objective, phase, round count, activation and optional blocker; errors retain the existing card. Tool descriptions adapt DSH guidance to the accepted no-get_goal/no-CAS/no-block-threshold contract without changing the System Prompt.

Verification:

- TDD: the first public create-goal test failed with `Tool create_goal not found`; the first tool-card test failed on raw JSON; the concurrent pause/resume public regression failed by restarting round 2. Each passed after its owning implementation.
- `rtk proxy bun test packages/agent/tests/e2e/goal-tools.test.ts apps/neant-tui/tests/screens/chat/goal-tool-cards.test.ts`: 25 new tests cover create/update authority, human steer, combinations, complete/blocked wrapup, pause/completion, pause/resume race, compact results, round cap, tool cards and localized error replay. Focused checks and `tsc -b` passed.
- `rtk proxy bun test packages/agent/tests/e2e/subagent-fork.test.ts apps/neant-cli/tests/e2e/cli.test.ts`: 56 pass / 0 fail, 343 assertions. Existing exact tool-list assertions now reflect the two top-level-only tools.
- First aggregate found two fixtures sensitive to the larger tool declarations. Preserved every behavior assertion while changing the split-prefix Compaction test window from 12,000 to 14,000 (still exactly two compactions, previous-goal grounding and resume equality), and Context Report visualization window from 10,000 to 11,000/reserve from 2,000 to 2,200 (still full/partial/free/reserve symbols, percentages, no model call). Their focused check passed 25 tests / 207 assertions.
- Final `rtk proxy env -u NO_COLOR caffeinate -is bun run check`: exit 0; formatting, lint, types and Knip passed; 1,757 tests / 0 failures, 9,261 assertions across 137 files. Log: `/tmp/goal-02-check.log`.
