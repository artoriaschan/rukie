Status: resolved
Blocked by: [05](05-subagent-tool-separation.md)

# 06：Plan Mode 状态控制从 Session 提取

## What to build

将 Plan Mode 状态、提醒、controller 与 Enter/Exit 工具适配聚合在 tools/plan-mode/。从 Session 提取已有状态规则，Session 注入存储和事件协调，保留原生命周期与父子共享接口。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

顶层 plan-mode/ 及 tools/enter-plan-mode.ts、tools/plan-review.ts 归 tools/plan-mode/，内部区分 state.ts、controller.ts、tools.ts；更新 session/index.ts、交互类型转导出和子 Session 内部接口。

## Acceptance Criteria

- [x] controller 拥有 active、hasEntered、revision、写入队列、失败回退、状态恢复与等待写入；沿用严格版本1的 plan 快照，不增加状态副本。
- [x] 先乐观切换内存再排队写入，同值调用等待既有 writes；仅最新 revision 失败回退至当前已成功 Tool State。
- [x] 队列的错误恢复允许后续写入，原调用仍接收失败；通知位于队列外，原调用等待通知但 flush 不等待通知队列。
- [x] Session 回调继续先保存必要 baseline 再写 plan，继续协调 Store 和 tool_state_changed 事件。
- [x] Run 外缓存/Run 开始交付仍归 Session；父子共用 controller，子无独立 plan snapshot。
- [x] Compaction/Rewind/Run结束/dispose 等原有位置等待 writes；Rewind 在恢复 Transcript/Tool State 后恢复 active/entered 并处理缓存事件。
- [x] hasEntered 由是否有快照决定，保留退出引导和按可用工具选择 reminder；公开 getter/setter 的 busy 限制保持。
- [x] 更新全部等待点和子 Session 投影，移除 Session 中重复的 plan 状态规则和顶层 plan-mode/ 旧归属；保留能力入口的直接状态接口，不抽取无关 Run/恢复架构。

## Verification

01 新增时序基线，以及 Plan Mode、Enter Plan Mode、Plan Review、Compaction、Checkpoint/Rewind、Subagent/fork共享与 CLI/TUI Plan 公开测试。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

重点记录存储拒绝、多个 revisions、回调再次 await 切换、Rewind后已有child、关闭等待的结果，保留原状态事件与Transcript断言。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
- 2026-10-07：实施完成。`packages/agent/src/plan-mode/`、`tools/enter-plan-mode.ts`、`tools/plan-review.ts` 迁至 `packages/agent/src/tools/plan-mode/`：`state.ts`（`planState` 严格版本1解析原样、`PlanSnapshot`、`PLAN_MODE_EXIT`、`planModeReminder`）、`controller.ts`（`createPlanModeController` / `PlanModeController`）、`tools.ts`（`enter_plan_mode` 与 `exit_plan_mode` 声明、`PlanReviewRequest`/`PlanReviewResult`/`OnPlanReview` 原样）、`index.ts`（能力入口）。消费者全部改为能力入口：`session/index.ts`（controller + 状态 + 两个工具工厂 + `OnPlanReview`，`InternalSessionOptions.plan?: PlanModeController`）、`packages/agent/src/index.ts` 包导出、`tools/index.ts` 删除 plan 转导出、`docs/architecture.md` 的 `plan-mode/` 行改为链接到 `tools/plan-mode/` 的行并从"尚未迁移"句移除 Plan Mode。仓库内已无旧路径引用（`grep` 仅命中新路径）。

  controller 语义（`controller.ts` 逐条对应原 Session 内联实现）：`getActive`/`hasEntered` 持有投影；`setMode` 同值先返回 `writes`（既有队列，含已排队写入且不接收其失败），否则先乐观翻转 `active`/`entered` 再按 queue 时递增的 `revision` 排队写入；仅 `revision === revision` 的最新失败从 `getSnapshot()`（= `toolState.get("plan")`）重算投影并重新抛出；`writes` 吞掉失败以便后续写入继续；`settleWrites()` 只返回队列（`writes = persisted.then(noop, noop)`），通知（`changed`）只挂在返回给原调用者的分支上；`restore()` 从快照重算投影且不重建实例、不重置 revision。plan 快照仍只有一份 `planState`（`{active: boolean}`、`version === 1`、单键对象），controller 只保存投影。

  Session 保留：`pendingPlanEvents` 与 Run 开始交付（`await plan.settleWrites()` 后 `splice(0)` 逐条 emit）、`withStore`/`serializeStore`/activeStore、baseline 先于 plan 写入、`changed` 决定 `emitRunEvent` 或缓存、`planReminder`（`source: "plan-mode"`，`currentContent()` 内按当前 `agent.state.tools` 惰性选择 `canSubmit` 文案）、`planTools` 可用性（`onPlanReview && !parentSessionId`）、`toolState("plan")` 投影、`planTakenOver`/`finishTurn`/Run 调度、`setPlanMode` 仅 `compacting`/`rewinding` busy 限制。5 个等待点改为 `await plan.settleWrites()`：`compact()`、`rewind()`、Run 开始、`prepareRequest`、Run teardown（仍在 `closeActiveStore` 之前）；Rewind 在 `toolState.restore(...)` 之后调用 `plan.restore()` 再清空 `pendingPlanEvents`；`dispose()` 未新增直接等待，保持原间接形状。

  测试（先写测试并在未改动实现上通过，再做变异验证；未修改任何原断言）：
  - 新增 5 项公开 `createSession` 用例（`packages/agent/tests/e2e/plan-mode.test.ts`）：同值等待（门控 `store.open`，同一值的第二次调用在写入 settle 前不 resolve）、通知不占用写入队列（Run 事件回调阻塞首条 plan 通知时，下一次切换仍写入并交付，原调用仍等待自己的通知）、dispose 关闭顺序（门控 plan 提交并记录提交/关闭顺序，断言两次排队 revision 都提交到 Run store 且 `store-closed` 最后、resume 后 `planMode` 为最后值）、严格 v1 解析（注入 `version: 2` 与 `{active: "yes"}` 条目后 resume 得到 `Unsupported plan version: 2`、`Invalid Plan Mode snapshot.` 两条 warning、`planMode` false、`toolState("plan")` undefined）、baseline 先于快照（存储分支中 plan 条目之前存在 message 条目）。
  - 变异验证：同值分支改回已 settled promise → 同值等待用例失败（`expect(repeated).toBe(false)` 收到 true）；把通知链放进 `writes` → 通知用例 5002ms 超时失败；反证两项均为必要行为。原有用例：多 revision 失败组合（`plan-mode.test.ts:383` 两种顺序）、失败后重试与 `closed === opened`（`:326`）、Run 中回调再次 await 切换（`:304`）、请求前 lazy 文案（`:70–72`）、退出引导只注入一次（`:46`/`:239`）、父子共享与子无快照（`:149` 两种、`:452`）原样通过。
  - 关闭等待用例的记录为"写入仍落地 + 最后一次提交早于 store 关闭"，但把 teardown 的 `await plan.settleWrites()` 移到 `closeActiveStore` 之后（或让 `settleWrites()` 返回 `Promise.resolve()`）该用例仍通过：本 harness 中 `serializeStore` 的 FIFO 与在途 mutation 已把排队写入排在关闭之前，因此该等待位置在公开 Store 接缝上不可独立区分（详见"未能验证"）。

  命令与结果（worktree `/Users/artorias_chan/.zcode/worktrees/agent-module-refactor-06/Neant`，基点 a4b16f4）：
  - `env -u NO_COLOR bun test` 21 个受影响套件（plan-mode、enter-plan-mode、plan-review、reminders、compaction、checkpoint、checkpoint-subagents、subagent-directory/fork/hooks/jobs/mcp-oauth/outcomes/permissions/reconciliation/types、subagents、tool-declarations、session-dispose、session-recovery、notification-hooks）→ 261 pass / 0 fail，1585 expect，21 文件，exit 0。
  - `env -u NO_COLOR bun test` TUI/CLI 计划套件（`apps/neant-tui/tests/e2e/plan-mode.test.ts`、`plan-review.test.ts`、`enter-plan-mode.test.ts`、`apps/neant-tui/tests/screens/chat/rewind.test.ts`、`apps/neant-cli/tests/plan-mode.test.ts`、`apps/neant-cli/tests/main.test.ts`）→ 126 pass / 0 fail，661 expect，6 文件，exit 0。
  - `bunx --no -- oxfmt --check` → exit 0（694 文件）；`bunx --no -- oxlint` → exit 0（398 文件，0 warning / 0 error）；`bunx --no -- tsc -b` → exit 0；`bunx --no -- knip` → exit 0（迁移中曾报告能力入口 `PlanSnapshot` 无消费者，改为不转导出后通过）。

  未能验证/限制：
  - 关闭等待（上述第 3 项）为回归保护而非可变异区分的证据：`plan.settleWrites()` 在 teardown 的位置按原样保留并断言了可观察顺序（两次提交均落在 Run store 上、`store-closed` 最后、`opened === closed` 语义），但移动该等待或让 `settleWrites()` 立即 resolve 都不会让该用例失败，因为 Session `serializeStore` 的 FIFO 与 harness 的 mutation line 已保证同一顺序。
  - `docs/architecture.md` 表格中的 `subagents/` 行仍为迁移前描述，按票 05 证据中的约定归票 07 同步；本票只改 Plan Mode 行与句中的 Plan Mode 名。
  - 未运行 `bun run check` 聚合检查（按实施请求保留给票 08）。

- 2026-10-07（票 08 复核，集成点 `ba200b7`，worktree `agent-module-refactor-08`）：逐条独立核对本票证据，结论为**成立**；本票已披露的限制保持披露，未被票 08 消除。

  内容保持核对：`tools/plan-mode/state.ts`（blob `dcb6970c…`）相对 `5c730be:packages/agent/src/plan-mode/index.ts`（blob `105fec9e…`）只有两处差异——导入路径 `../tool-state/index.ts` → `../../tool-state/index.ts`，以及新增 `export type PlanSnapshot = { active: boolean };`；`planState` 的严格版本 1 解析、`PLAN_MODE_EXIT`、`planModeReminder(canSubmit)` 三处逐字未改。`tools/plan-mode/tools.ts`（blob `e081abb5…`）是 `tools/plan-review.ts`（`324c374f…`）与 `tools/enter-plan-mode.ts`（`c97e3141…`）的合并：`createEnterPlanModeTool` 逐字搬入，原文件里名为 `parameters` 的 `exit` schema 与 `enter` 的空 schema 分别改名为 `reviewParameters`/`enterParameters` 以避免同名冲突，两个 schema 内容与所有 description、结果文本、`details`、`isError`、`terminate` 标记不变。`PlanSnapshot` 只在同目录 `controller.ts` 使用，能力入口不转导出（与票内"改为不转导出后 Knip 通过"一致）。

  controller 语义复核（`tools/plan-mode/controller.ts:39-71`）：`setMode` 同值先 `return writes`（既有队列，且不接收其失败）；异值先改内存投影 `active`/`entered` 再 `++revision`，`write = writes.then(() => options.persist(on))`；`persisted` 的 catch 仅在 `current === revision` 时用 `snapshot()`（= `toolState.get("plan")`）重算投影并重新抛出；`writes = persisted.then(noop, noop)` 吞掉失败；通知 `options.changed(...)` 只挂在 `return persisted.then(...)` 上，不在 `writes` 链内。`settleWrites()` 返回 `writes`，`restore()` 从快照重算且不重建实例、不重置 revision。Session 侧 5 个等待点全部为 `await plan.settleWrites()`（Run 开始、`compact()`、`rewind()`、`prepareRequest`、Run teardown），`rewind()` 在 `toolState.restore(...)` 之后调用 `plan.restore()` 再清空 `pendingPlanEvents`；`session/index.ts` 已无 `planActive|planEntered|planWrites|planRevision`（`git grep` 无命中），即 Session 中不再存在第二份 plan 状态规则。

  命令与结果（worktree `agent-module-refactor-08`，`ba200b7`）：
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/plan-mode.test.ts` → 18 pass / 0 fail，exit 0。本票声称新增的 5 项用例名逐一命中：`a repeated Plan Mode change waits on the pending write`、`a pending Plan Mode notification does not hold the write queue`、`dispose keeps the Run store open until queued Plan Mode writes settle`、`an unsupported or malformed Plan Mode snapshot is ignored on resume`、`the first Plan Mode write saves the Session baseline before the snapshot`；另 2 项（多 revision 失败组合、父 Rewind 后 child 继续）属票 01。
  - `env -u NO_COLOR bun test packages/agent/tests` → 1390 pass / 0 fail，79 文件，exit 0；`env -u NO_COLOR bun test apps/neant-tui/tests/e2e/plan-mode.test.ts apps/neant-tui/tests/e2e/plan-review.test.ts apps/neant-tui/tests/e2e/enter-plan-mode.test.ts apps/neant-tui/tests/screens/chat/rewind.test.ts apps/neant-cli/tests/plan-mode.test.ts apps/neant-cli/tests/main.test.ts` 属 TUI/CLI 全量套件的一部分（`env -u NO_COLOR bun run test:tui` → 956 pass / 0 fail，exit 0；`env -u NO_COLOR bun run test:cli` → 127 pass / 0 fail，exit 0）。
  - `git log --oneline 5c730be..ba200b7 -- packages/agent/tests/e2e/plan-mode.test.ts` → `bc88d33`（能力迁移）与 `8a6d5b7`（基线）；`git diff 5c730be..ba200b7 -- packages/agent/tests/e2e/plan-mode.test.ts` 的删除行只有 2 行 import，原断言零改动。

  仍保留的限制（本票已披露，票 08 未使其可独立区分）：
  - teardown 的 `await plan.settleWrites()` 位置用公开 Store 接缝无法独立区分（把它移到 `closeActiveStore` 之后或让 `settleWrites()` 立即 resolve，本票的 dispose 用例仍通过）；`serializeStore` 的 FIFO 与在途 mutation 已保证同一顺序。票 08 只确认等待点与断言存在，不宣称该位置被变异验证区分。
  - 本票记录的两项变异验证（同值分支改回已 settled promise → 用例失败；把通知链放进 `writes` → 用例 5002ms 超时失败）未由票 08 重放：重放需要在生产代码上制造临时变异，超出最终审查票的范围。这两项属本票自证。

- 2026-10-07（后续重放）：同值分支改为 `Promise.resolve()`，`a repeated Plan Mode change waits on the pending write` 在 8.52ms 失败（repeated 收到 true）；把 `changed` 放入 writes 链，`a pending Plan Mode notification does not hold the write queue` 在 5001.55ms 超时。两次 exit 1，均用 finally 恢复原生产文件。0ms 宏任务屏障保留，teardown 等待点在 Session Store 接缝上不可独立区分的限制保持。
