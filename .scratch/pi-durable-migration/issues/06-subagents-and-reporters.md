# 06: 后台 Subagent ownership 与持久化结果通知

Status: claimed
Blocked by: none

## What to build

用原生 background anchor task、owned Conversation 和 reporter 替换旧 Subagent 调度。保留 subagent/fork/send_message 及类型限制，恢复时复用 child、提交与通知身份。提供请求因果范围的公开完成观测供 Headless 使用，不能把普通 parent idle 改成旧“等待全部子代理”。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [x] 默认后台 ownership，父 Run 可先结束；普通父 abort 不触及 child，显式停止所选 child 取消其活跃 ownership scope并等待原生终态。
- [x] 子代理不允许嵌套，类型/工具/MCP 过滤、权限收窄、父级共享 Plan Mode 与 Interaction 来源转发继续有效。
- [x] 创建和 fork 使用持久化 child/task 身份，send_message 使用稳定 requestId；重复打开或 task replay 不新增同一个逻辑 child/input。
- [x] 子 Run 结束与 reporter 提交独立持久化；在 child done → reporter pending、通知提交 → 父处理未结算等窗口恢复，最终只逻辑投递一次且继续处理。
- [x] close 后未结算 child 和 reporter 可恢复，显式被取消/完成的工作不因打开新建；保留 Run Outcome 与委派验收的区别，不仅看当前进程活动。
- [x] 公开请求结算观测包含对应 child Run、reporter 与通知引发的新处理；排除空闲 background anchor、历史身份和无关工作，不用一次任务列表采样替代稳定结算。
- [x] 子 Run 的 OS Job 与连接资源按自有资源约束清理，任务可恢复不意味着 OS 进程仍存在；来源事件和子视图只报告已提交事实。

## Testing Decisions

经 createSession+受控父子模型覆盖父先停/child后停、Esc、显式 child stop、close/reopen、fork/send_message、授权与结果窗口。可恢复逻辑通过独立进程切断及重新打开验证稳定身份；Frontends 的全请求等待在 08 验证。用 deferred model/commit predicates 同步，不轮询全局进程活跃状态推断完成。

## Verification

实现完成，待独立 merger 审核；Status 保持 claimed。从精确 `044fad3f` 开始。公开测试先复现两个不同 send_message 复用 provider callId 丢失第二条输入（164ms RED）、interruptSubagent 返回 void（117ms RED）、第二次人类发送请求在 child 活动时提前结算（164ms RED）。发送与 idle→active 复用分支的 requestId 改用原生 ToolTask 身份；不增加按描述复用 subagent 的新产品语义。显式停止返回 Promise，并等待 native driver terminal；未知 id 拒绝，空闲为 no-op。Frontend 的两个停止入口处理失败。

请求因果范围沿已提交 native owner、origin ToolTask 和 child Submission 的 ToolTask-derived 身份计算，可关联多个请求；reporter 处理一次事务登记全部关联根请求。新发送请求等待原活动 driver 的报告，后续报告产生的新 child 纳入稳定收敛，空闲／历史／无关工作不因身份存在而加入。SDK provider Session 身份直接从实际 StreamOptions.sessionId 捕获，按初次输入确认父子身份，后续仅按已学身份驱动；不按上下文中的旧 Human 文字猜测 reporter。

新增真实 SIGKILL 四窗口：child done→report pending、report input 已提交→driver acknowledgement 未返回、父级 report generation 挂起、parent answer 已提交→driver terminal 未提交。使用 public native Storage commit，先完成真实提交再阻断 acknowledgement，公开 Session 创建 child；在第二个独立进程冷恢复。四例保留同一 child／driver／父 provider Session 身份，child 不重跑，report 只逻辑投递一次且实际处理，第二次空闲打开零新模型调用。真实进程传输使用 5s 失败边界，每例约390ms；不使用 sleep，不承诺网络 attempt 或任意副作用 exactly-once。

验收对应：父先 idle／普通 abort 与 sibling 隔离由 subagents、subagent-interrupt；类型／工具／嵌套／MCP／权限／共享规划／来源由 types、permissions、fork、hooks、MCP OAuth；创建／fork／复用身份由 directory、reconciliation、identities；恢复窗口由 report-recovery；明确取消冷恢复与 sibling 恢复由 interrupt；late descendant／无关 held child 排除及二次发送因果等待由 identities；OS Job／连接及已提交观测由 jobs、observation、outcomes。Run Outcome 与委派验收仍分开。

已运行 focused：九文件 subagents／directory／reconciliation／jobs／types／permissions／identities／interrupt／report-recovery，87 PASS、606 assertions、9.16s，exit0；额外 fork／hooks／MCP OAuth／observation／outcomes，34 PASS、226 assertions、3.13s，exit0。停止冷恢复增强后单例1 PASS／11 assertions／152ms；TUI subagent-views 真实 keyboard／mouse stop 两例2 PASS／13 assertions／1.17s。后续局部 source 查询去重与同事务注册补测见 Comments。未运行 package／aggregate，最终统一 gate 属于09。

ADR Coverage：沿用 ADR-0024 的唯一 native 执行、后台 ownership、稳定身份、close／abort 和请求结算边界；ADR-0009 保留 Activity／Run Outcome／委派验收区别，其旧不续跑约束由0024替代；ADR-0011 的 subagent 能力归属、ADR-0010 的 OS resource 清理、ADR-0014／0015 的权限和共享规划、ADR-0019 的凭据与连接边界不变。无新执行器、新信任决策或 replaySafe 扩张，不需新ADR。更新 owning Agent README、CONTEXT、architecture 子代理段与 ADR-0009 过时实施状态；其余运行架构整体对齐留在09。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-08：05 独立集成 resolved 于 `044fad3f`；06 在新工作树 `codex/pi-durable-06-subagent-recovery` 从该精确基线认领。公开 createSession、实际 Models provider 的 StreamOptions.sessionId、原生 Storage commit 和真实独立进程切断为已确认测试入口；按 tdd 逐条 RED→GREEN。外部准备见 `/tmp/pi-durable-ticket06-drafts/`。

2026-10-08：后续公开 tracer 发现重复 stop 在 Activity 已 false、reporter 仍运行时提前返回（native status running，128ms RED）。停止能力仍仅取消活动 child，但所有调用都 join 同一 driver terminal；不将取消通知提交等同于终结。修正后 stop／身份／late-descendant 两文件3 PASS／44 assertions／562ms，冷恢复验证取消 child 不重跑、sibling 沿原 SDK身份恢复。late descendant 使用真实 subagent_fork，确认继承已完成父输入且获独立 provider身份，增强后 identities2 PASS／33 assertions／445ms。

2026-10-08：同事务登记多根因果关联与每轮复用原生记录查询后，三个新增文件7 PASS／91 assertions／2.14s；safe／unsafe native未知结果及真实 receipt-loss replay 当前授权六例6 PASS／49 assertions／2.35s。最终当前 `bun run check:dev` exit0：format、lint、TypeScript、Knip、tracker、docs 与 ink boundaries 全部通过（`/tmp/pi-durable-06-static-final.log`）。`git diff --check` 通过；再次合并 `codex/pi-durable-migration` 为 Already up to date。工作树 `/tmp/rukie-pi-durable-06`，分支 `codex/pi-durable-06-subagent-recovery`。未运行 package／aggregate。只在当前 macOS 上验证真实 SIGKILL，不将其扩大为断电或跨平台证据。
