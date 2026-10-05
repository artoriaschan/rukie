# 03: 异常退出后的子 Run 核对与续跑

**What to build:** 用户在子代理执行期间异常退出进程后恢复父 Session，系统只读核对尚未结算的新 Run，准确提醒中断或无法确认；子 Run 已保存的结束事实优先于滞后的父摘要。用户随后仍能通过原有输入和 `send_message` 继续原子 Session。

**Blocked by:** 02 — 正常关闭后的恢复提示与摘要。

**Status:** resolved

- [x] 恢复父 Session 时，仅核对父摘要中尚未结算的新 Run，按父子所属关系和 Run 身份只读观察对应子 Transcript。
- [x] 子 Transcript 已记录结束、父摘要未更新时，按子结束事实呈现，不误判为中断；保留该 Run 的实际结束原因。
- [x] 有开始事实、核对后无结束事实且没有对应运行实例时呈现中断；不能仅凭过期父摘要或无法读取就判为中断。
- [x] 子记录缺失、损坏、无法读取或无法可靠关联时，该项保留未知并给出无法确认诊断；父 Session 及其他子项继续恢复。
- [x] 已结算 Run 使用父摘要，旧记录保持未知；大量历史子会话不触发全量扫描或加载。
- [x] 核对不物化子 Agent、不请求模型、不修复子 Tool 结果；观察后释放读取资源，子 Transcript 内容保持不变。
- [x] 当前分支与所属 Session 的事实为边界，不能将上一 Run、fork 继承信息或 Rewind 移出的摘要作为本次结束事实。
- [x] 核对结果进入 02 的一次性 TUI 提示与首次真实输入摘要，完成项不报警，中断和无法确认项准确说明；重渲染和后续输入不重复注入。
- [x] 恢复后没有实际子 Run 时自动列表隐藏，手动历史视图展示准确的最近 Run 信息。
- [x] 用户之后经 `send_message` 复用原子 Session id 和 Transcript，启动新的 Run；新的活动与结束信息不沿用历史中断或完成。
- [x] 真实父 prompt 和子后续写入继续遵守 Checkpoint 规则，只读核对及恢复摘要不产生新锚点。
- [x] Core 公共入口测试覆盖未闭合新 Run、父摘要滞后、先完成后中断、混合缺失或损坏记录，以及读取范围；使用真实进程中断或合法存储夹具，不能以正常 dispose 模拟崩溃。
- [x] TUI 启动入口测试覆盖异常退出恢复后的说明、历史视图、无自动执行，以及用户要求继续后的原子代理续跑。

## Scope boundary

依赖 02 提供的结构化恢复呈现与一次性摘要，并继承 01 的 Run 关联事实。本工单只实现异常退出的只读核对和续跑入口衔接，不增加后台巡检、全量子会话修复、自动续跑或新的运行架构。独立工单 04 负责实际打开 Session 时的孤立 Tool 调用修复；本工单不能提前修改子 Transcript。

## Testing and delivery

以规范《Subagent 的 Run Outcome 与 Session Resume》、CONTEXT 和 ADR-0009 为准。复用 Core 的 `createSession`、真实临时 Session Store 与可控模型，以及 TUI 实际启动入口和虚拟终端。断言恢复事实、可见提示、模型调用次数、原 id 复用、子 Transcript 不变和公共存储观察范围；不依赖内部集合形状。

由子代理使用 implement skill 在独立 worktree 中开发，完成有意义的行为测试及 Standards / Spec review，提交可集成的变更。集成按阻塞依赖进行；整批通过要求的检查后合并 main 并清理开发工作树。

## Comments

### 2026-10-05 — 实施与验证

- 在独立 managed worktree `/Users/artorias_chan/.codex/worktrees/subagent-resume-03/Neant`、分支 `codex/subagent-resume-03` 实施。开发前确认 `d5c5ccf868bd88d356d37af33f31fed6e1144826` ancestry、干净状态，执行 frozen install；完成前再次 merge 最新 integration，结果 already up to date。
- Session Store 仅扩展可选 `find` 与 `openReadonly` 能力。原生 JSONL 查找只读取目标 id 的 header，继续使用原生 codec；只读文件能力阻止原生 open 对 torn tail 的修补写入。opaque 注入 Store 没有能力时保守 unknown + unconfirmed。未改变运行调度、Store 格式或实际恢复的 04 repair。
- 父恢复仅观察 pending 新 Run，以当前 main branch、child/parent/Run id 和开始事实关联；子持久化结束优先父 stale 摘要；可靠未闭合事实为 interrupted，其余故障逐项 unknown + diagnostic。观察在 finally 关闭，不物化 child Agent、不请求模型、不修复子 Tool、不创建 Checkpoint。结构化 history 供手动视图使用，02 提示和首个真实输入摘要继续复用。
- Core 公共入口新增 13 个用例：合法存储崩溃窗口、stale 父摘要、混合 missing/header/body/torn/unreadable、原始 byte 不变、25 个 settled 加 legacy 的 targeted 观察、opaque Store、第二 Run、当前分支与 fork 归属、同一真实 Store 成功/失败观察后重新打开，以及 send_message 的原 id/历史、04 延后 repair、新 Run 和父 Checkpoint/Rewind。
- TUI 实际 start/main 新增中英文 40×12 用例：一次中断/无法确认提示，无自动请求或活动列表，手动历史 completed/interrupted 准确，真实输入经 send_message 继续原子代理。
- 公共 red→green：`/tmp/neant-resume-03-red-1.log` → `/tmp/neant-resume-03-green-1.log`；TUI 诊断 `/tmp/neant-resume-03-red-tui.log` → `/tmp/neant-resume-03-green-tui.log`；Rewind `/tmp/neant-resume-03-red-rewind.log` → `/tmp/neant-resume-03-green-rewind.log`。
- 相关 Core/TUI 回归：`env -u NO_COLOR bun test`，exit 0，75 pass / 0 fail，533 expects，9 files；日志 `/tmp/neant-resume-03-focused-final.log`。最终同 Store 读取资源释放补强：13 pass / 0 fail，52 expects，日志 `/tmp/neant-resume-03-resource-final.log`。
- 类型检查：`bunx tsc -b` exit 0，日志 `/tmp/neant-resume-03-types-final.log`。完整检查：`env -u NO_COLOR caffeinate -is bun run check` exit 0，1615 pass / 0 fail，8449 expects，120 files，200.72s；日志 `/tmp/neant-resume-03-check-final.log`。
- 自查已核对公开行为、只读及概念 index 导入边界。**Standards / Spec 独立双轴审查：整批集成后待主线程执行**，此处不声称已通过独立审查。
- 实现提交：`59a1ca0c0726ca94c72920c8f7a1198a08e376cd`（`feat(agent): reconcile interrupted subagent runs`）。提交 hooks 通过；提交后 `git status --short` 无输出，`git diff --stat` 为空，最新 integration `d5c5ccf868bd88d356d37af33f31fed6e1144826` 仍为 HEAD 的 ancestor（exit 0）。本次仅追加提交证据，主线程负责集成 main、独立审查和清理工作树。

### 2026-10-05 — 整批集成验收

四张工单及审查修复已集成；最终完整检查 1622 pass / 0 fail，最终相关回归 97 pass / 0 fail。独立 Standards / Spec 复核均 0 项剩余问题，验收通过。详细证据见 [verification.md](../verification.md)。
