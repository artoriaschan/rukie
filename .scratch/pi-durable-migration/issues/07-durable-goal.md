# 07: Goal 续跑改为可恢复的原生任务

Status: claimed
Blocked by: none

## What to build

保留 Goal 产品能力与状态边界，把活跃自动续跑表达为持久化原生任务/提交，移除独立进程 armed/idle scheduler。目标恢复只能继续已接受的工作，不因为一条历史目标事实建立新执行授权。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [x] 活跃 Goal 任务 close/reopen 后恢复，round 输入使用稳定身份；轮次计数与相关提交/终态关联，恢复不重复计数或重复创建 prompt。
- [x] 暂停、受阻、完成、轮次耗尽、清除和显式取消的目标保持停止；重新开启仍需真实用户授权，模型内部续跑不自授权。
- [x] 用户输入、Hook continue 与通知沿原生 inbox/任务调度，不再维护另一套模型循环；既有 maxRounds 与错误/停止义务明确，不能越限。
- [x] 只有顶层 Session 拥有 Goal；Todo 与 Goal 分开，子 fork 不继承可执行的父 Goal 任务，Rewind 不复制后来自动续跑。
- [x] Goal 文案、状态查询与事实事件使用持久化状态及原生任务观测，不能把“有目标”或“父 idle”当成当前在续跑。
- [x] Headless --goal 的请求范围包含相关后台结果处理；完成、失败、暂停、上限和主动中断能产生明确退出结果，不永久等待空闲 anchor。

## Testing Decisions

公开 createSession 验证每个状态与 round boundary，复用 Goal/Goal tools 与 async Hook prior art。控制提交前后、round结束后续输入前及 child reporter 阶段重启，断言实际模型输入数/状态/预算而非 scheduler 私有字段。少量 Frontend smoke 在 08 验证。

## Verification

2026-10-08：基于已独立集成的 06 `06bcd201` 实施，仍为 claimed，等待独立 merger 复核与关闭。

- `tools/goal/driver.ts` 拥有原生 `rukie.goal-driver`、持久化 activation、稳定 round reservation 与因果结果；Session 只注入原生 submission/receipt 接口。删除进程 armed/startRound/idle scheduler，Generation 仍是唯一模型执行器。
- 初始/后来 reservation、已放置但 driver ACK 丢失三个窗口使用独立 Bun 进程、真实 JSONL commit 与 SIGKILL。原实现初始/后来两个公开用例 RED（0 pass / 2 fail，512ms）：计数先行，恢复没有相应 prompt。新实现以 Task input/checkpoint 固定 round，实际 Input 放置后计数，三窗口恢复不重复身份/计数；第二次 reopen 产生零模型调用。
- 已接受 round 在 Goal complete 后仍恢复其真实 receipt；等待在 Human model 接受 create_goal 前建立也能动态发现关联 driver。Goal 根请求累计各轮与相关 child/report 的结果和不重叠 provider usage，不把第一轮当整个请求结算。
- pause/clear 在 queued round 边界原来多调用一次模型（3 对 2，87ms RED）；现在 Goal 状态撤销与 Inbox withdrawal/Submission settlement 同一原生事务。placed-before-count pause 原来 roundsStarted 为 0（65ms RED），现在在撤销事务中对已放置 Input 计数，后续真实 Human resume 正确执行 round 2。旧 receipt 不会撤销新 activation。
- 显式 abort 保留已提交前轮 usage 和当前已提交 partial，原生 Task Outcome 仍为 aborted；取消 Goal driver 不取消或等待独立运行的 child。当前 Goal mutation ToolResult 保持真实原生提交边界。暂停、完成、受阻、轮次耗尽、清除、错误和 abort 的历史事实不建立新授权。
- usage 补充公开 RED：快速 Human 创建 Goal 后 receipt 越界累计后续轮次（22873 对 15947 tokens）；held child/report 结算只留最后父 receipt（7317 对 16832 tokens）。按原生 answer 边界读取完整已提交 entries，并以 EntryId 去重联合所有父 submission receipts；两个公开用例及原有轮次/取消 usage 用例 GREEN，均比较实际父/child/报告 assistant usage 各一次。
- 保留 Human inbox 优先级、Stop/Hook 续跑、Goal 完成 wrap-up、最大轮数、Todo 独立状态、子 fork 无可执行 Goal、Rewind 拒绝活跃原生 Goal task、close/reopen 同已接受工作。更新公开事实/文案与 Agent README、CONTEXT、architecture 和 ADR-0018 历史替代说明。

实际验证（全部 exit 0）：

- `env -u NO_COLOR bun test packages/agent/tests/e2e/goal-recovery.test.ts packages/agent/tests/e2e/goal.test.ts packages/agent/tests/e2e/goal-tools.test.ts packages/agent/tests/e2e/mcp-goal.test.ts`：60 pass，254 assertions，3.77s；日志 `/tmp/pi-durable-07-focus-final3.log`。
- `env -u NO_COLOR bun test packages/coding-agent/tests/headless/main.test.ts -t "[Gg]oal"`：9 pass，41 assertions，687ms；日志 `/tmp/pi-durable-07-headless-final3.log`。覆盖 --goal 完成、失败/长度、后台因果结果、启动 Hook 和取消恢复。
- `env -u NO_COLOR bun test packages/agent/tests/e2e/subagent-identities.test.ts packages/agent/tests/e2e/subagent-report-recovery.test.ts`：共享 receipt usage 改动的因果与四个真实 crash 窗口影响检查，6 pass，81 assertions，2.04s；日志 `/tmp/pi-durable-07-causal-impact.log`。
- `bun run check:dev`：format、lint、项目 typecheck、Knip、scratch、docs 与 ink boundaries 全部通过；日志 `/tmp/pi-durable-07-static-final3.log`。

独立进程 crash 用例每个约 200ms，真实进程/内核 lease/SIGKILL 是验收对象，虚拟时钟不能替代；全部等待以 native receipt、commit、模型/进程完成信号为界。未运行 package/full/aggregate，最终 Frontend 综合验收与全套 gate 留给 08/09。

ADR Coverage：ADR-0024 已明确原生持久化 Goal task 与停止/授权边界；此票落实该决定，无新增架构决定。ADR-0018 标注已被 ADR-0024 部分替代，保留历史决策，不继续描述旧进程 scheduler 为现行实现。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-08 独立 review 纠正：补充两个组合因果公开场景。Human 同一 Run 创建 Goal 与 child，child report 在 Goal round 中排队时，原结算错误覆盖后来 report 的回答（返回 Goal round evidence 而非 shared report final，127ms RED）；此排队场景 usage 已正确，未把它声称为 double-spend RED。第二场景由 Human 创建 Goal、Goal round 创建 held child，原 round answer 先提交、child 后报告；仅按 round requestId 前缀收集原 input 会丢失 reporter receipt 的 spend（19846 对 23159 tokens，143ms RED）。现在以每轮 RequestDoc.submissions 取得包含 report 的实际 receipts，把 Human／Goal／report entries 按 native EntryId 合并，child spend 按 native driver TaskId 去重，最终回答取组合范围中实际最后的 assistant entry。仅对有 accepted Goal driver 的请求覆盖最终 text，保留无 Goal 的 PlanTakeover 等既有输出语义。

纠正后 focused `goal-recovery`／`goal`／`goal-tools`／`mcp-goal`／`subagent-identities`／`subagent-report-recovery` 六文件：68 PASS、341 assertions、6.78s（`/tmp/pi-durable-07-review-focus.log`）；Headless Goal 九例：9 PASS、41 assertions、778ms（`/tmp/pi-durable-07-review-headless.log`）；`bun run check:dev` 全部通过（`/tmp/pi-durable-07-review-static.log`）。均 exit0，未运行 package 或 aggregate。
