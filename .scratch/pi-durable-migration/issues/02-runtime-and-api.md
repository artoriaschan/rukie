# 02: durable 运行基座、目标依赖与公开接口

Status: claimed
Blocked by: 01

## What to build

切换 Agent Core 的运行所有权与目标依赖，建立 Frontend-facing Session 到 durable Harness/Conversation 的单一路径。更新所有受影响工作区消费者、provider 绑定、模型 helpers 与基础工具协议，不交付旧 API shim、旧 Agent loop fallback 或空实现。后续票补齐专门的状态、恢复和能力验收，不把基础闭环通过描述为整体迁移完成。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [x] 所有实际需要的 pi/Chord 直接和解析依赖精确对齐 1.0.4；bun.lock 同步；所有工作区移除 pi-agent-core 与旧私有入口。
- [x] Session 提交、流式观察、工具 execution、steer/follow-up、Run/Turn 结束和 Compaction 调用走原生 Harness；Session 不再修改旧 Agent.state 或自行运行模型循环。
- [x] 产品 Session 与 Conversation、Harness、Submission 的身份和生命周期映射清楚；公开调用方可区分父 Run idle、任务恢复与整次请求结算。
- [x] 模型/provider 设置、自定义模型、代理、凭据输入和 fake model helpers 已接入目标 pi-ai；原先支持的模型设置没有因接口升级消失。
- [x] 订阅使用 committed snapshot/events，处理批量增量和 snapshot 重置；没有重复消息、已关闭视图写入或 callback 自等待。
- [x] 每次接口变更更新受影响消费者与类型；目录依赖方向继续有效，Frontend 无具体执行器依赖，Agent Core 保持 locale-agnostic；coding-agent 的旧 pi devDependencies 按新测试 helpers 实际消费改为目标版本或移除，不误列为生产依赖。

## Testing Decisions

公开 createSession 的受控模型闭环覆盖 input → model/tool → committed result → idle/close；同时跑 headless main 与最小 TUI 启动，验证消费者同版本契约。模型流多轮次覆盖 microtask 边界与最后事件后的结算。更新现有辅助模型 helper 而非每个套件复制新 provider。运行聚焦测试和受影响格式、lint、类型检查。

## Verification

2026-10-08 实施中，尚未关闭。生产路径已使用原生 Harness、Conversation、Models、ToolRegistration、Submission 和 committed 观察；旧 Agent loop 与私有 Session Store 消费者已替换。当前源码提供原生文档、JSONL 主文件 flush、主机 SQLite 独占租约，以及产品事实投影；这些基础实现不代替 03–08 的专门验收。

公开行为的实际聚焦验证（退出码均为 0）：

| 范围                       | 命令中的测试文件                                                                     | 结果                    | 时间   |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------- | ------ |
| 权限规则、Hook 与执行阶段  | `permission-hooks`、`permission-rules`、`post-allow-stage`                           | 74 pass，260 assertions | 3.68 s |
| 原生 Compaction 与 Goal    | `compaction`、`goal`                                                                 | 35 pass，212 assertions | 2.40 s |
| Plan Mode                  | `plan-mode`                                                                          | 21 pass，91 assertions  | 1.23 s |
| 异步 Hook                  | `async-hooks`                                                                        | 13 pass，54 assertions  | 0.99 s |
| MCP 协议、管理与声明       | `mcp`、`mcp-api`、`tool-declarations`                                                | 65 pass，286 assertions | 2.87 s |
| 中断、作业停止通知与关闭   | `post-tool-hooks`、`job-api`、`session-dispose`                                      | 39 pass，177 assertions | 4.65 s |
| 子代理权限与权限 Hook      | `subagent-permissions`、`permission-hooks`                                           | 42 pass，147 assertions | 2.91 s |
| 真实进程丢失不安全工具回执 | `unknown-tool-outcomes`                                                              | 6 pass                  | 2.04 s |
| 实时与恢复 Thinking 时长   | Agent `thinking`、TUI `thinking`                                                     | 12 pass，55 assertions  | 1.62 s |
| 原生 Goal 工具回执         | `goal-tools`                                                                         | 21 pass，71 assertions  | 1.17 s |
| 异步警告与关闭生命周期     | `session-dispose`                                                                    | 9 pass，34 assertions   | 2.02 s |
| 恢复模型与选择器           | TUI `model-switch`、`resume-picker`                                                  | 6 pass，33 assertions   | 0.96 s |
| 子代理 fork 与原子 Rewind  | `session-title`、`checkpoint`、`checkpoint-subagents`                                | 53 pass，281 assertions | 3.87 s |
| MCP 上下文归属与恢复       | `context-report`                                                                     | 6 pass，34 assertions   | 0.48 s |
| 原生并行权限轮次屏障       | `permission-review`、`subagent-permissions`、`permission-hooks`、permissions `batch` | 80 pass，269 assertions | 4.62 s |
| 持久化拒绝来源             | `permission-denial`、permissions `provenance`                                        | 8 pass，19 assertions   | 0.29 s |
| 压缩、拒绝来源与原生观察   | `compaction`、`permission-denial`、tools `native-observation`                        | 21 pass，160 assertions | 1.63 s |
| Stop 前用量与初始类型目录  | TUI `context-report`                                                                 | 9 pass                  | 1.12 s |

上述命令统一使用 `rtk proxy bun test packages/agent/tests/e2e/<name>.test.ts ...`。关闭预算用例实际覆盖跨进程 1.5 秒资源回收契约，保留真实时间；其余同步使用模型回复、原生结算、文件事件和进程退出。

`rtk proxy bunx --no tsc -b --pretty false` 已通过全部工作区类型检查；受影响源文件的 oxfmt、oxlint 通过。受影响 Agent package 首轮为 1436 pass / 30 fail，coding-agent package 首轮为 1307 pass / 146 fail；正在用最小用例区分原生消费者差异、共享时钟级联与真实源码缺陷，不能把后续局部通过报告成包检查通过。最终聚合检查保留给 09，尚未执行。

populated-directory fork 原子事务冲突已修复：子代理目录使用原生 rewindable 历史与 fork initial 策略；Rewind 通过公开 snapshotAsOf 读取锚点目录，在创建目标 Conversation 的同一事务内恢复目录，保留原先不存在与显式空目录的区别。已有子代理时的 fork 与 Checkpoint 恢复均已通过公开行为测试。恢复模型的首帧投影、实时 Thinking 时长和异步警告字符串边界也已通过实际 TUI 回归。全部工作区类型检查与 Knip 已通过。

2026-10-08 补充：`rtk proxy bun run check:dev` 已通过格式、lint、全部工作区类型、Knip、tracker、docs 与 ink 边界检查。权限轮次以原生 LiveDoc 中的实际 task ID 协调并行审查，并在屏障后重新检查停止状态；被停止的同批次工具不能凭先前授权执行。拒绝来源按原生 ToolTask ID 写入产品事实，实时与冷恢复均输出 typed permissionDenial，重复 provider call ID 不会串用事实。Stop 前的 provider input/cache 用量先提交产品测量事实，再发布 context_usage；类型发现先于工具描述组装，初始 /context 不启动模型也可显示实际目录。

Compaction 后的公开 Transcript 现在使用公开 Storage 的 fork-aware 完整历史并按实际 Entry ID 顺序投影；模型上下文仍采用原生 active head。公开回归验证旧 Human/Read 回执保留、真实压缩 notice 位于此前消息之后、冷恢复顺序不变，以及下一次 provider context 不重新包含已压缩 Read 内容。Rewind 的目标分支仍按其原生 fork cutoff 投影，不显示已丢弃分支。

2026-10-08 当前实施交付待集成复核：受影响包第二次检查的实际结果为 Agent 1481 pass / 3 fail（50.26 s，6490 assertions），coding-agent 1397 pass / 56 fail（89.42 s，10069 assertions）。这些结果仍是失败，未重复包检查，也未执行最终聚合检查。Agent 的三个失败已通过最小公开回归修正：完整 Transcript 中保留的 Todo 回执和权限请求新增 callView 的断言；审批断言使用请求副本，避免 matcher 改写真实 AbortSignal。coding-agent 的失败逐项定位为原生租约交接、原生背景任务与因果结算边界、受控模型目录、真实 provider context、以及可见终端裁剪下的测试同步；相应修复记录在实际提交中，不能从局部通过推断包检查整体通过。

最新实际聚焦结果：Panel、Plan Review、Plan Mode、Session Recovery 与 Recovery History 共 49 pass / 317 assertions / 14.67 s；MCP 真实传输、原生 Goal、Context Usage 与 MCP 两个 TUI 文件共 74 pass / 449 assertions / 7.88 s；真实 CLI 78 pass / 449 assertions / 20.41 s；Jobs UI 32 pass / 176 assertions / 12.38 s。前台公开 waitForIdle 回归验证原生父 Run 已 idle 时仍等待主机回执提交完成，Run 与 Close 共 20 pass / 69 assertions / 2.42 s。上述修改后的当前 `rtk proxy bun run check:dev` 再次通过全部静态、tracker、docs 与边界检查。

MCP 按原生 Run 边界刷新保留的配置/连接；普通 Human Run 在 admission 前保留可取消发现，内部 Goal/report 请求也刷新当前配置。原生 generation preparation 先于 beforeRequest，因此晚到的实际工具声明以公开 pi-ai 系统消息写入 committed `rukie.mcp-loadout`，再替换该次请求消息。公开真实服务测试验证首个 Goal provider context 已含 MCP 工具、下一轮配置移除立即作用于实际工具声明，并保留 manager 当前快照；不使用私有 prompt planner 或第二条执行路径。

仍需在 02 关闭前完成：集成复核与 merger 在 integration 分支确认交付状态。03–08 保持依赖门禁，另行验证存储故障/并发恢复、挂起 Interaction 重授权、有限因果结算崩溃窗口、Goal 原子续轮以及 Frontend 回放和终端矩阵；不得从本票聚焦通过推断这些验收完成。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：Frontend 消费已合并 dsh ink 的公开 API；Session 接口迁移不得恢复旧 renderer options、primitives 或 input event union。当前 Agent Core 和 Headless 生产路径尚未迁移。

2026-10-08：02 基于集成 5f7f63e5 在 codex/pi-durable-02 开始实施；采用 tdd 的公开 Session 与 Frontend seams，原生 Models/ToolRegistration/committed events 作为唯一新契约。
