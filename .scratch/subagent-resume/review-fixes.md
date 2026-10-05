Status: resolved

# Subagent Resume — 整批审查修复

固定点：`24a6c41a10dca49b3ae331e2d9becdf299e706cd`，独立 managed worktree `subagent-resume-review-fixes/Neant`，分支 `codex/subagent-resume-review-fixes`。开发前确认 ancestry 和干净状态，完成 frozen install。此文件记录修复与验证证据；Standards / Spec 复审由主线程在集成后执行，未声称复审通过。

## 发现与处理

- [x] Standards：按 CLAUDE 的概念目录规则，把只读子 Run 核对、恢复结果类型和模型摘要移到 `packages/agent/src/session-resume/index.ts`；把 Tool 孤立调用发现、Unknown Tool Outcome 占位与持久化移到 `packages/agent/src/unknown-tool-outcomes/index.ts`。Session 只保留打开/关闭、恢复投影、首次真实输入投递等生命周期接线。跨概念均通过 index，既有 Agent 外部 `SessionRecovery` API 及 shared 的 runtime-agnostic 识别器保持兼容。
- [x] Spec P2：`tool_state_changed/subagents` 与初始化使用同一份公开 `session.recovery`，复用已有 child id + Run id 匹配，避免无关新 child 摘要把已核对 completed/interrupted 历史降为 unknown。新的同 child Run 仍按新 id 显示真实活动，不能借用旧 Run 的结局。
- [x] Panel：最小原用例在 100 次循环的第 16 次出现与整批相同的 `1/1` 断言失败。公开可控模型记录证实此时 `first` / `second` 两个 child 请求都存在且 signal 未取消，父后续请求另有身份，测试未完成任一 child 流。`tool_state_changed` 保留既有 status/model/output，仅历史 outcome 接线存在上述真实 bug；原面板断言读到了 child `session_start` 通知合并前的旧终端帧。改为先确认两个 child 请求身份与未取消，再等待实际可见的 `2/2`，没有 sleep、重试或活动语义修改。原用例之后 100 次 green。

## 公共 red → green 与自查

- 历史回归：`/tmp/neant-resume-review-history-red.log` 两例失败（completed/interrupted 均降为 unknown），`/tmp/neant-resume-review-history-green.log` 两例通过。实际 main/start、真实临时 Store、虚拟终端；覆盖无关更新后历史、新 Run 不借旧结局，以及现有活跃 child 的 status/model/streamed output 不被摘要更新覆盖。
- 面板反馈环：`/tmp/neant-resume-review-panel-stress-red.log` 第 16 次断言失败；`/tmp/neant-resume-review-panel-stress-green.log` 100 pass / 0 fail，1800 expects，35.76s。诊断临时标记已清除。
- 抽取后公共 Core/TUI：`/tmp/neant-resume-review-extraction-focused.log` 27 pass / 0 fail，171 expects；既有 unknown repair、readonly bytes、关联/branch/fork、Checkpoint、Hook 和首次真实输入摘要均保留公共验收边界。
- 类型检查：`/tmp/neant-resume-review-types-1.log`，`bunx tsc -b` exit 0。
- 最终相关 Core/TUI 回归：`env -u NO_COLOR bun test`，exit 0，97 pass / 0 fail，710 expects，11 files，13.95s；日志 `/tmp/neant-subagent-resume-review-fixes-focused-final.log`。最终历史两例包含同 child 新 Run 真实 error 结束后不借旧结局，24 expects；日志 `/tmp/neant-resume-review-history-green.log`。
- 最终类型检查：`bunx tsc -b` exit 0，日志 `/tmp/neant-subagent-resume-review-fixes-types-final.log`。Knip exit 0，日志 `/tmp/neant-subagent-resume-review-fixes-knip.log`。
- 完整检查：`env -u NO_COLOR caffeinate -is bun run check` exit 0，1622 pass / 0 fail，8542 expects，121 files，202.92s；日志 `/tmp/neant-subagent-resume-review-fixes-check-final.log`。完整检查后仅补强新 Run error 结束的测试断言，生产实现无变化；最终 focused 与类型检查覆盖该补强，不重复完整检查。
- 最新 integration 仍为固定点 `24a6c41a10dca49b3ae331e2d9becdf299e706cd`；同步结果 already up to date。三个发现的实现修复完成，提交 SHA 和 clean / ancestry 结果在交付时报告主线程。此处 resolved 仅指修复工作完成，Standards / Spec 独立复审仍待集成后执行，规范状态不提前关闭。

## 独立复审结果

2026-10-05：修复提交 a3291604a1b294ba412eb2177184ce478e558a7b 已快进集成。Standards 复核 0 项标准违反、0 项新增 smell；Spec 复核 0 项剩余发现，并独立重跑公共历史回归 2 pass / 0 fail / 24 assertions。全部原发现已解决，最终证据见 [verification.md](verification.md)。
