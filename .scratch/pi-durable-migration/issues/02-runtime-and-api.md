# 02: durable 运行基座、目标依赖与公开接口

Status: claimed
Blocked by: 01

## What to build

切换 Agent Core 的运行所有权与目标依赖，建立 Frontend-facing Session 到 durable Harness/Conversation 的单一路径。更新所有受影响工作区消费者、provider 绑定、模型 helpers 与基础工具协议，不交付旧 API shim、旧 Agent loop fallback 或空实现。后续票补齐专门的状态、恢复和能力验收，不把基础闭环通过描述为整体迁移完成。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 所有实际需要的 pi/Chord 直接和解析依赖精确对齐 1.0.4；bun.lock 同步；所有工作区移除 pi-agent-core 与旧私有入口。
- [ ] Session 提交、流式观察、工具 execution、steer/follow-up、Run/Turn 结束和 Compaction 调用走原生 Harness；Session 不再修改旧 Agent.state 或自行运行模型循环。
- [ ] 产品 Session 与 Conversation、Harness、Submission 的身份和生命周期映射清楚；公开调用方可区分父 Run idle、任务恢复与整次请求结算。
- [ ] 模型/provider 设置、自定义模型、代理、凭据输入和 fake model helpers 已接入目标 pi-ai；原先支持的模型设置没有因接口升级消失。
- [ ] 订阅使用 committed snapshot/events，处理批量增量和 snapshot 重置；没有重复消息、已关闭视图写入或 callback 自等待。
- [ ] 每次接口变更更新受影响消费者与类型；目录依赖方向继续有效，Frontend 无具体执行器依赖，Agent Core 保持 locale-agnostic；coding-agent 的旧 pi devDependencies 按新测试 helpers 实际消费改为目标版本或移除，不误列为生产依赖。

## Testing Decisions

公开 createSession 的受控模型闭环覆盖 input → model/tool → committed result → idle/close；同时跑 headless main 与最小 TUI 启动，验证消费者同版本契约。模型流多轮次覆盖 microtask 边界与最后事件后的结算。更新现有辅助模型 helper 而非每个套件复制新 provider。运行聚焦测试和受影响格式、lint、类型检查。

## Verification

2026-10-08 实施中，尚未关闭。生产路径已使用原生 Harness、Conversation、Models、ToolRegistration、Submission 和 committed 观察；旧 Agent loop 与私有 Session Store 消费者已替换。当前源码提供原生文档、JSONL 主文件 flush、主机 SQLite 独占租约，以及产品事实投影；这些基础实现不代替 03–08 的专门验收。

公开行为的实际聚焦验证（退出码均为 0）：

| 范围                       | 命令中的测试文件                                           | 结果                    | 时间   |
| -------------------------- | ---------------------------------------------------------- | ----------------------- | ------ |
| 权限规则、Hook 与执行阶段  | `permission-hooks`、`permission-rules`、`post-allow-stage` | 74 pass，260 assertions | 3.68 s |
| 原生 Compaction 与 Goal    | `compaction`、`goal`                                       | 35 pass，212 assertions | 2.40 s |
| Plan Mode                  | `plan-mode`                                                | 21 pass，91 assertions  | 1.23 s |
| 异步 Hook                  | `async-hooks`                                              | 13 pass，54 assertions  | 0.99 s |
| MCP 协议、管理与声明       | `mcp`、`mcp-api`、`tool-declarations`                      | 65 pass，286 assertions | 2.87 s |
| 中断、作业停止通知与关闭   | `post-tool-hooks`、`job-api`、`session-dispose`            | 39 pass，177 assertions | 4.65 s |
| 子代理权限与权限 Hook      | `subagent-permissions`、`permission-hooks`                 | 42 pass，147 assertions | 2.91 s |
| 真实进程丢失不安全工具回执 | `unknown-tool-outcomes`                                    | 6 pass                  | 2.04 s |

上述命令统一使用 `rtk proxy bun test packages/agent/tests/e2e/<name>.test.ts ...`。关闭预算用例实际覆盖跨进程 1.5 秒资源回收契约，保留真实时间；其余同步使用模型回复、原生结算、文件事件和进程退出。

`rtk proxy bunx --no tsc -b --pretty false` 已通过全部工作区类型检查；受影响源文件的 oxfmt、oxlint 通过。受影响 Agent package 首轮为 1436 pass / 30 fail，coding-agent package 首轮为 1307 pass / 146 fail；正在用最小用例区分原生消费者差异、共享时钟级联与真实源码缺陷，不能把后续局部通过报告成包检查通过。最终聚合检查保留给 09，尚未执行。

仍需在 02 关闭前完成：已发现的 populated-directory fork 原子事务冲突、受影响包失败收敛、静态依赖检查与集成复核。03–08 保持依赖门禁，另行验证存储故障/并发恢复、挂起 Interaction 重授权、有限因果结算崩溃窗口、Goal 原子续轮以及 Frontend 回放和终端矩阵；不得从本票聚焦通过推断这些验收完成。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：Frontend 消费已合并 dsh ink 的公开 API；Session 接口迁移不得恢复旧 renderer options、primitives 或 input event union。当前 Agent Core 和 Headless 生产路径尚未迁移。

2026-10-08：02 基于集成 5f7f63e5 在 codex/pi-durable-02 开始实施；采用 tdd 的公开 Session 与 Frontend seams，原生 Models/ToolRegistration/committed events 作为唯一新契约。
