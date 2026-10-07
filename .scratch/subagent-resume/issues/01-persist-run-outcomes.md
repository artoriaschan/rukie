# 01: 恢复已结束子 Run 的历史状态

**What to build:** 用户关闭并恢复父 Session 后，能在现有子代理历史视图中看到子身份及最近一次 Run 的真实结束原因。当前运行活动与历史结束事实分开，正常结束不被当作整个委派任务已验收，旧记录保留未知。

Blocked by: None (can start immediately).

Status: resolved

- [x] 每次子 Run 有稳定身份；开始执行前保存可关联子 Session 与 Run 的开始事实，结束事实先保存在子 Transcript，再更新父摘要。
- [x] 父摘要保留子身份、最新 Run 关联和已知结束信息；旧 Run 的原始事实不改写，续跑产生新 Run 身份。
- [x] 正常结束、错误或其他已知结束原因诚实保留；`completed` 仅表示该次 Run 正常结束，不宣称整个委派任务完成。
- [x] 恢复已结算子 Run 时使用父摘要，保留原 Session id 和 Transcript，不创建子运行实例或请求模型。
- [x] 旧子代理身份记录能够读取；缺少 Run 事实时呈现未知，不从 assistant 文本或 `idle` 推断完成。
- [x] 模型侧 `list_agents` 的现有运行状态语义保持兼容；结束原因作为独立信息通过 Session 公共状态或事件可观察。
- [x] TUI 手动子代理历史视图能展示最近 Run 的已知结束原因或未知；没有实际运行中的子 Run 时，自动列表保持隐藏。
- [x] `send_message` 对空闲子代理复用原身份和历史，对活跃子代理保留 steer；最新呈现不会借用上一 Run 的完成原因。
- [x] 只使用当前分支和所属 Session 的事实，Rewind 或 fork 继承上下文不能制造本次子 Run 的新结束事实。
- [x] 新数据有版本且兼容现有 Tool State 与原生 Session Store，不替换 Agent loop 或 JSONL 格式。
- [x] Core 公共入口测试覆盖正常结束与错误、同一子代理多次 Run、旧记录、重新创建 Session 恢复；TUI 启动入口测试覆盖历史状态与自动列表隐藏。

## Scope boundary

本工单打通已结算历史的持久化、公共呈现和 TUI 验证。正常关闭的等待边界与恢复摘要归 02；未结算 Run 的子 Transcript 核对和崩溃分类归 03；孤立 Tool 调用修复归 04。本工单不能把尚未核对的新 Run 擅自归为中断，也不新增恢复警告流程。

## Testing and delivery

以规范《Subagent 的 Run Outcome 与 Session Resume》、CONTEXT 和 ADR-0009 为准。复用 `createSession`、可控模型、真实临时 Session Store，以及 TUI 实际启动入口与虚拟终端；断言公共状态、模型请求、重新打开后的 Transcript 和可见输出，不直接测试内部 Map 或 reducer。使用公开完成信号同步。

由子代理使用 implement skill 在独立 worktree 中开发，完成有意义的行为测试及 Standards / Spec review，提交可集成的变更。集成按阻塞依赖进行；整批通过要求的检查后合并 main 并清理开发工作树。

## Answer

子 Transcript 通过版本 1 的 `tool-state/subagent-run` 保存带 `id`、子 Session id、父 Session id 和开始时间的 Run 事实；结束后追加同一 Run 的结束快照，再更新父 `subagents` 版本 2 的 `latestRun` 摘要。新 Run 分配新 id，不修改旧 Run 事实。`completed` 只表示该 Run 正常结束；模型错误、明确中止、输出长度上限及 Hook 停止/阻止保留独立原因和诊断。

恢复已结算历史只使用当前父分支的摘要，不创建子 Session 或请求模型；版本 1 的旧身份与尚未结算记录保持未知，另一父 Session 的结束信息不能成为本父 Session 的已知事实。`Session.toolState("subagents")` 与既有 `tool_state_changed` 提供结构化观察，`list_agents` 继续只报告实际 `running` / `idle`。TUI 手动历史显示 Run 原因，40×12 元信息优先显示子 id；没有实际运行的子 Run 时自动列表保持隐藏。

## Comments

- 使用 implement 与 tdd skill，遵循已批准的 `createSession` / 可控模型 / 真实临时 Session Store 以及实际 TUI main/start / 虚拟终端边界。未测试内部 Map、reducer 或私有序列化顺序。
- Red→green：completed 恢复摘要最初缺少 `latestRun`；模型主动 aborted 最初被归为 error，length 最初被归为 completed；foreign parent 摘要最初错误保留 completed；TUI 恢复详情最初只显示 idle，live Hook 停止最初只显示 completed。对应测试均失败后完成修复。
- Core 新增 9 例覆盖 completed、error、model aborted、length、Hook 停止、多次 Run / 原身份历史 / 新 Run 不借上一结束原因 / Rewind、legacy、unsettled 与父所属校验。TUI 新增中英文 40×12 混合历史及 live Hook 原因 3 例；现有 resume、fork、steer、Checkpoint、dispose、布局与 Rewind 回归继续执行。
- 首次完整检查 1577 pass / 1 fail 找到 40×12 的真实时间挤掉 id 回归；改为元信息先显示 id，保留身份可见性，更新原 idle 预期为 Run 正常结束。
- 已合入最新集成 tip `f467539fc29372ec850154c5e887400ddf36a8b5`（含 04）并执行 frozen install。01+04 共存 focused：`rtk proxy env -u NO_COLOR bun test` 对 13 个相关文件，exit 0，165 pass / 0 fail，1069 expect；日志 `/tmp/neant-resume-01-focused-final.log`。`rtk proxy bunx tsc -b` exit 0。
- 最终完整检查：`rtk proxy env -u NO_COLOR caffeinate -is bun run check`，exit 0；format、lint、tsc、knip 均通过，1588 pass / 0 fail，8262 expect，117 files，191.26s；日志 `/tmp/neant-resume-01-check-final.log`。
- 实现提交 `7a95f74`；合入集成分支后的开发 merge tip `2c455c1`。实现者已按 code-review 的 Standards / Spec 材料自查；主线程调整交付安排，独立 Standards / Spec 双轴审查由整批集成阶段完成，当前待完成，不声称已通过独立审查。
- 01 不实现 02 的 Frontend 关闭收束/恢复摘要，也不实现 03 的子 Transcript 只读核对/中断分类。03 之前，新 Run 开始但未结算仅呈现未知。main、集成目录及其他工单的用户改动未在本开发 worktree 外编辑。

### 2026-10-05 — 整批集成验收

四张工单及审查修复已集成；最终完整检查 1622 pass / 0 fail，最终相关回归 97 pass / 0 fail。独立 Standards / Spec 复核均 0 项剩余问题，验收通过。详细证据见 [verification.md](../verification.md)。
