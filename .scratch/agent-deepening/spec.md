Status: claimed

# Spec: Agent Core 深化重构

术语见 `CONTEXT.md` 的 Request、Session、Run、Turn、Transcript、Tool State、Goal、Subagent、Interaction、Deferred Tool、Tool Search。架构约束见 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)、[ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)、[ADR-0026](../../docs/adr/0026-protocol-independent-tool-search.md)。

## Problem Statement

`packages/agent/src/session/index.ts` 是一个约 3900 行的 `createSession` 闭包，约 40 个可变状态集中声明后被所有职责簇直接读写，内部没有 seam。最近 80 次 `src/` 提交中 48 次触及该文件，恢复与结算类修复集中在调用点：请求身份字符串在约 15 处被反解析，root 与 child Conversation 的工具策略逐段镜像，工具 loadout 在两处装配、四处规划，Goal 的激活与轮次规则写在 Session 中。这些逻辑只能经完整 `createSession` Run 和崩溃 worker 测试。

## Solution

按依赖顺序把职责簇收进 deep module，Session 只保留组合、公开 `Session` 对象与生命周期：

1. Request Ledger（`src/requests/`）拥有 Request 身份、绑定、因果与结算。
2. Goal 续跑归 `tools/goal`，Session 只提供 submit/settle adapter。
3. Conversation Runtime（`session/conversation/`）为 root 与 child 统一装配工具策略。
4. Tool Loadout 在 `session/tools.ts` 原地深化。
5. Interaction 拥有 pending interaction 的写入与识别。
6. `tools/` 根目录支撑代码收进 `tools/support/`，`prompt/` 并入 Session。

MCP 拆深（catalog 与 OAuth 授权）不在本 spec 范围，另行立项。

## Implementation Decisions

- **Request Ledger**：顶层 `src/requests/`，能力 module 与 Session 都可导入。负责铸造与识别类型化 Request 身份、绑定 submission/task、解析 task 的 Request 因果、结算等待者，并持有当前前台 Request 及启动恢复时的重建。字符串编码只在 Ledger 内部，格式保持不变，已有 Session 继续可恢复。
- **Ledger 管结算条件，不管结果内容**：Ledger 判定哪些回执属于一个 Request、何时全部结算，持久化最终结果并只发布一次 `request_settled`。把已结算回执组装成 `RequestResult` 是纯函数，Goal 与 Subagent 各自提供读取自身回执（driver 结果、`parentAnswer`、`usage`）的规则；Ledger 不依赖能力的结果格式，`tools/goal` 依赖 Ledger 不成环。
- **Request 结局事实归 Ledger**：当前 Run 服务的 Request 由 Ledger 解析；hook stop 原因与 plan takeover 作为按 Request 记录的结局事实归 Ledger，由结果组装读取。是否停止仍由 Session（之后为 Conversation Runtime）决定。写入在调用方的事务内完成，与 `hook_stopped` notice 原子提交。
- **Session 公开接口不变**：`Session.currentRequestId` 与 `waitForRequest(requestId: string)` 保持不透明字符串，委托 Ledger；Frontend 不改。
- **单一 durable extension 入口**：`rukie.session` 仍是 `beforeRequest`、`onYield`、`afterTools` 等 hook 的唯一入口，按固定顺序调用能力接口；能力不另注册同名 hook。理由见 [ADR-0028](../../docs/adr/0028-single-session-harness-hook-entry.md)：`onYield` 无否决，优先级隐含于 extension 顺序，非 abort 错误被上报后继续执行。
- **Goal**：`tools/goal` 拥有激活校验、driver 任务创建与中止、轮次计数、wrap-up 与激活清理；Session 提供 submit/settle adapter，Request 身份经 Ledger。
- **Conversation Runtime**：`session/conversation/` 下的工厂，root 与 child 各调用一次，输入 Conversation 身份与策略（origin、隐藏工具、stop 标志），产出 permission gate、hook 运行器、jobs、file tracking 与 `beforeTool`/`afterTool`。`forkAt` 与子代理模型选择移入 `tools/subagents/controller`。Session 不再导入 `tools/subagents/state.ts`。
- **Tool Loadout**：原地深化 `session/tools.ts`，吸收 `rebuildTools`、`refreshChildTools`、`childLoadout`、声明 diff、MCP drift 判定与子代理排除名单；`planToolSearchLoadout` 保持为纯函数核心。输出只由 Transcript 与当前输入推导，不新增缓存（ADR-0026）。
- **Interaction**：`interaction` 识别 pending interaction，MCP 只提供 kind 判定，删除 `hasPendingMcpInteraction` 的格式解析。
- **目录整理**：`tools/` 根目录共享运行时支撑移入 `tools/support/` 并同步 `.oxlintrc.json`；`builtin.ts` 是否移动按其组装入口角色确认。`prompt/` 并入 `session/prompt.ts`。

## Testing Decisions

- 新 module 在 `packages/agent/tests/` 下镜像目录直测（`tests/requests/`、`tests/session/conversation/`、`tests/session/tools.test.ts`、`tests/tools/goal/`），使用内存 Storage 或假 harness。
- 每条恢复/结算路径保留一个代表性 e2e 冒烟用例（含崩溃 worker）；等价断言迁到 module 测试后删除对应 e2e 用例。删减前后记录 Bun 耗时。
- 每张票先跑受影响的最小测试集；全部完成后运行一次 `env -u NO_COLOR bun run check`。

## Delivery

分支 `refactor/agent-deepening`，每票一个 Conventional Commit，不 push。

## Out of Scope

- MCP catalog/OAuth 拆深。
- Request 编码格式变更与数据迁移。
- Session 公开接口与 Frontend 行为变化。

## ADR Coverage

| 决定或修改                            | 归属                                                                                                                                       | 理由                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 能力目录与 Session 组合               | 沿用 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)                                                                             | 新 module 遵循能力不依赖 Session、Session 组合能力的方向                                  |
| durable 执行与恢复                    | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)                                                                           | 不改变执行、持久化与恢复语义，Request 编码保持不变                                        |
| 原生 hook 只由 Session extension 注册 | 新增 [ADR-0028](../../docs/adr/0028-single-session-harness-hook-entry.md)                                                                  | `onYield` 无否决、优先级隐含于注册顺序，能力改为提供接口由 Session 按序调用               |
| Tool Loadout 无缓存                   | 沿用 [ADR-0026](../../docs/adr/0026-protocol-independent-tool-search.md)                                                                   | loadout 仍由 Transcript 推导，装配位置仍在 `session/tools.ts`                             |
| Interaction pending 身份归属          | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md) 与 [ADR-0015](../../docs/adr/0015-frontend-interactions-and-plan-mode.md) | Interaction 识别原生阶段与 memo，恢复依据当前配置重新发起，保留取消与缺失回调的安全默认值 |
| 共享 support 与 System Prompt 归属    | 沿用 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)                                                                             | 支撑与具体协议工厂分开，Prompt 归 Session；不改变 API、持久化或运行行为                   |

## Implementation ADR Review

六项实施决定已逐项对照源码：Request Ledger 与能力 receipt reader 保持单向依赖；Goal runtime 提供普通续跑接口；Conversation Runtime 统一 root/child 工具策略；Tool Loadout 从当前 Transcript 和输入规划；Interaction 持有 pending 身份格式；共享支撑与 Prompt 按能力依赖方向归位。原生 hook 仍由 Session 在固定入口注册，没有新增能力原生 hook。Request 编码及 document version 不变，未引入缓存、MCP catalog/OAuth 拆分或 Frontend API 变化。ADR-0011/0024/0026/0028 覆盖实施决定，Interaction 同时沿用 ADR-0015；未发现需要替代既有决定的架构变更。此记录为实施覆盖审阅，最终代码审阅和 aggregate 验证完成后才关闭 spec。
