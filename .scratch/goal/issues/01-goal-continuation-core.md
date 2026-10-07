# 01: Goal 续跑核心

**What to build:** 通过 Session API 给顶层 session 设一个 Goal 后，Agent Core 在每个 run 结束时自动开下一轮 goal round，直到用户 pause / clear、达到续跑上限转 blocked，或者因出错 / 中止 / token 超限而 disarm。Goal 作为 Tool State 持久化，resume 和 rewind 后恢复，但不会自动开跑。模型每个 run 都能经 reminder 看到 objective 和轮次，compaction 后立即补回。详见 [Goal spec](../spec.md) 的 Tool State、Session API、续跑调度、disarm 条件、round 消息、reminder、子代理几节。

Blocked by: None (can start immediately)

Status: resolved

- [x] Tool State `goal`（v1）：完整快照 `{ id, objective, phase, roundsStarted, maxRounds, blockedReason? }`，clear 写 `null` tombstone；坏记录跳过并告警；armed 不持久化
- [x] Session 暴露 `goal: GoalView | undefined`，以及 `createGoal` / `editGoal` / `pauseGoal` / `resumeGoal` / `clearGoal`；各方法的状态前置条件与空闲限制照 spec，非法调用抛可读错误
- [x] `createGoal` 在空闲时立即开第 1 轮；之后每个 run 结束开下一轮，调度排在 Stop hook 与 asyncRewake 之后，并且要等子代理全部结束
- [x] round 消息照搬 DSH `renderGoalRoundPrompt`（删去 "read the current goal" 一句，并在注释注明来源与改动），带 goal 来源标记，不作为 Checkpoint 锚点，不参与 Session Title fallback
- [x] 只有 round 消息计数；用户 run、Stop hook 续跑、子代理通知都不计数；用户在 armed 期间自发 run，结束后续跑照常
- [x] 下一轮之前若 `roundsStarted >= maxRounds`，转 blocked，原因为上限说明
- [x] run 以错误、中止或 `length` 结束时只 disarm；`resumeGoal` 后继续，计数延续
- [x] `pauseGoal` / `clearGoal` 在 run 中可用，不打断当前 run，只是不再开下一轮
- [x] `goal` reminder（objective、phase、round n/max，blocked 时附原因）：goal 非 complete 时注入，compaction 后立即重注入
- [x] resume / rewind / fork 恢复出的 goal 为 disarmed；rewind 到 goal 创建前时 `goal` 为 undefined
- [x] Permission Mode 为 `ask` 时，`createGoal` / `resumeGoal` 经 `onWarning` 建议切 `auto-review`
- [x] 子 session：`goal` 为 undefined，方法抛错，不挂 driver，不注入 reminder
- [x] Agent Core e2e 覆盖以上行为（spec Testing Decisions 入口 1 中不涉及模型工具的部分）

## Answer

已实现顶层 Session Goal API 与 `goal/` 模块：完整 v1 Tool State 快照及 null tombstone、进程内 armed、Goal reminder 与 DSH round prompt。内部 Run 使用 `source: "goal"`，只在 Goal round 准入时推进计数；不建立 Checkpoint，不产生 Session Title fallback。Stop hook 与子代理完成后，现有 asyncRewake 先处理，再调度 Goal；排队用户 Run 优先于下一轮。错误、中止与 length disarm，pause / clear 保留当前 Run；resume / rewind 重建 Goal 后保持 disarmed。fork 子代理过滤父 Goal reminder，并保持无 Goal 状态、工具和 driver。新增错误码及通用中英文映射遵循 ADR-0008。

验证采用 spec 已确认的 `createSession` + fake model 公共入口，未新增测试 seam。

- TDD 首轮 red：`createGoal` 尚不存在；green 后逐步覆盖暂停、清除、恢复、生命周期、持久化和 reminder。
- 回归 red：创建后立即 pause 时内部 round 已进入 Run，但 `roundsStarted` 仍为 0；将轮次快照推进移到 Run 准入点后 green。
- 回归 red：fork 子代理收到父 Goal reminder；过滤 fork 初始消息中的该 reminder 后 green。
- `rtk bun test packages/agent/tests/e2e/goal.test.ts`：19 pass / 0 fail / 100 expect；覆盖上限、Stop hook 续跑、子代理等待、用户 Run 优先级、错误/中止/length、运行中 pause/clear、resume/rewind、坏快照告警、complete 恢复与 edit 新建、compaction 立即重注入和去重、ask 告警。
- `rtk proxy sh -c 'env -u NO_COLOR bun run check > /tmp/goal-01-check.log 2>&1'`：exit 0，1732 pass / 0 fail / 9170 expect，135 files，206.16s。完整检查包含 format、lint、types、Knip 和全部测试。
- 完整检查后仅将 fork 测试的工具声明断言改为 `getCurrentSystemMessage`（当前有效工具）；全部 19 个 Goal 用例再次通过，并重跑 types、format 与 diff 检查。

模型工具和收尾指令属于 ticket 02；TUI 与 Headless 接入属于后续 ticket。本票未扩展公开 fork API，现有恢复路径按 Session Store Transcript 分支重建 Goal。
