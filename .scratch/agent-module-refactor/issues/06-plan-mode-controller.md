Status: ready-for-agent
Blocked by: [05](05-subagent-tool-separation.md)

# 06：Plan Mode 状态控制从 Session 提取

## What to build

将 Plan Mode 状态、提醒、controller 与 Enter/Exit 工具适配聚合在 tools/plan-mode/。从 Session 提取已有状态规则，Session 注入存储和事件协调，保留原生命周期与父子共享接口。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

顶层 plan-mode/ 及 tools/enter-plan-mode.ts、tools/plan-review.ts 归 tools/plan-mode/，内部区分 state.ts、controller.ts、tools.ts；更新 session/index.ts、交互类型转导出和子 Session 内部接口。

## Acceptance Criteria

- [ ] controller 拥有 active、hasEntered、revision、写入队列、失败回退、状态恢复与等待写入；沿用严格版本1的 plan 快照，不增加状态副本。
- [ ] 先乐观切换内存再排队写入，同值调用等待既有 writes；仅最新 revision 失败回退至当前已成功 Tool State。
- [ ] 队列的错误恢复允许后续写入，原调用仍接收失败；通知位于队列外，原调用等待通知但 flush 不等待通知队列。
- [ ] Session 回调继续先保存必要 baseline 再写 plan，继续协调 Store 和 tool_state_changed 事件。
- [ ] Run 外缓存/Run 开始交付仍归 Session；父子共用 controller，子无独立 plan snapshot。
- [ ] Compaction/Rewind/Run结束/dispose 等原有位置等待 writes；Rewind 在恢复 Transcript/Tool State 后恢复 active/entered 并处理缓存事件。
- [ ] hasEntered 由是否有快照决定，保留退出引导和按可用工具选择 reminder；公开 getter/setter 的 busy 限制保持。
- [ ] 更新全部等待点和子 Session 投影，移除 Session 中重复的 plan 状态规则和顶层 plan-mode/ 旧归属；保留能力入口的直接状态接口，不抽取无关 Run/恢复架构。

## Verification

01 新增时序基线，以及 Plan Mode、Enter Plan Mode、Plan Review、Compaction、Checkpoint/Rewind、Subagent/fork共享与 CLI/TUI Plan 公开测试。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

重点记录存储拒绝、多个 revisions、回调再次 await 切换、Rewind后已有child、关闭等待的结果，保留原状态事件与Transcript断言。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
