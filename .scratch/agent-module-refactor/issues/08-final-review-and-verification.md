Status: ready-for-agent
Blocked by: [07](07-session-assembly-and-boundaries.md)

# 08：最终 Standards/Spec 审查与完整验证

## What to build

对集成后的重构按工程约定与本spec逐项审查，运行最终检查并对齐票状态和证据。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

全部受影响Agent Core、CLI/TUI消费者、文档、lint与本功能工单。发现范围内回归在 owning module 修复，重新运行受影响验证。

## Acceptance Criteria

- [ ] Standards审查模块入口、依赖、严格类型、冗余实现、旧内部路径和无用途抽象；Spec审查Q1–Q11与每票验收。
- [ ] 验证内置协议、结果/错误细节、事件、动态刷新、Transcript与包公开导出兼容，CLI/TUI消费者保持。
- [ ] 对照 182d278 基线与 Spec 的 MCP 验收，复核快照公开类型、刷新/管理/通知/取消契约，以及普通/fork 子 Session OAuth origin、凭据共享和精确工具继承；确认复用了相应公开套件，Frontend 面板状态没有进入 Agent Core。
- [ ] 核对Plan Mode和Subagent的并发、存储失败、父子共享、恢复与取消完成边界，以及Bash/Job进程资源清理。
- [ ] 运行隔离配置且清除NO_COLOR的完整bun run check，记录实际退出码、通过/失败计数与日志。
- [ ] 复查工程规则、架构、ADR迁移状态、源码及文档链接一致，根CLAUDE.md软链接保留。
- [ ] 核对顶层 bash/web-fetch/goal/jobs/subagents/plan-mode/review 旧落点、散落的 Plan 工具、tool-state Todo 定义及废弃转导出均已删除；能力内部协议/执行分工和全部消费者没有遗漏。
- [ ] 将各票状态与真实完成结果对齐，追加实施和验证证据；未解决检查或范围内问题不能标为resolved。
- [ ] 提交、合并、worktree清理由后续执行请求授权范围决定，本票不自行扩大Git操作范围。

## Verification

完整 env -u NO_COLOR bun run check；发现新改动或失败时补跑有必要的公开专项。文档运行 oxfmt --check、链接核对及 git diff --check。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

最终报告改动、公开行为证据、实际检查结果、未解决项和Git状态；没有当前证据不宣称已完成。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
