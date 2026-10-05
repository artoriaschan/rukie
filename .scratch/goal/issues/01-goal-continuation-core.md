# 01: Goal 续跑核心

**What to build:** 通过 Session API 给顶层 session 设一个 Goal 后，Agent Core 在每个 run 结束时自动开下一轮 goal round，直到用户 pause / clear、达到续跑上限转 blocked，或者因出错 / 中止 / token 超限而 disarm。Goal 作为 Tool State 持久化，resume 和 rewind 后恢复，但不会自动开跑。模型每个 run 都能经 reminder 看到 objective 和轮次，compaction 后立即补回。详见 [Goal spec](../spec.md) 的 Tool State、Session API、续跑调度、disarm 条件、round 消息、reminder、子代理几节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Tool State `goal`（v1）：完整快照 `{ id, objective, phase, roundsStarted, maxRounds, blockedReason? }`，clear 写 `null` tombstone；坏记录跳过并告警；armed 不持久化
- [ ] Session 暴露 `goal: GoalView | undefined`，以及 `createGoal` / `editGoal` / `pauseGoal` / `resumeGoal` / `clearGoal`；各方法的状态前置条件与空闲限制照 spec，非法调用抛可读错误
- [ ] `createGoal` 在空闲时立即开第 1 轮；之后每个 run 结束开下一轮，调度排在 Stop hook 与 asyncRewake 之后，并且要等子代理全部结束
- [ ] round 消息照搬 DSH `renderGoalRoundPrompt`（删去 "read the current goal" 一句，并在注释注明来源与改动），带 goal 来源标记，不作为 Checkpoint 锚点，不参与 Session Title fallback
- [ ] 只有 round 消息计数；用户 run、Stop hook 续跑、子代理通知都不计数；用户在 armed 期间自发 run，结束后续跑照常
- [ ] 下一轮之前若 `roundsStarted >= maxRounds`，转 blocked，原因为上限说明
- [ ] run 以错误、中止或 `length` 结束时只 disarm；`resumeGoal` 后继续，计数延续
- [ ] `pauseGoal` / `clearGoal` 在 run 中可用，不打断当前 run，只是不再开下一轮
- [ ] `goal` reminder（objective、phase、round n/max，blocked 时附原因）：goal 非 complete 时注入，compaction 后立即重注入
- [ ] resume / rewind / fork 恢复出的 goal 为 disarmed；rewind 到 goal 创建前时 `goal` 为 undefined
- [ ] Permission Mode 为 `ask` 时，`createGoal` / `resumeGoal` 经 `onWarning` 建议切 `auto-review`
- [ ] 子 session：`goal` 为 undefined，方法抛错，不挂 driver，不注入 reminder
- [ ] Agent Core e2e 覆盖以上行为（spec Testing Decisions 入口 1 中不涉及模型工具的部分）
