Status: resolved

# Spec: Agent Core 模块归属与职责重构

## Problem Statement

维护者寻找或修改一个 Agent Core 能力时，无法仅凭职责判断代码归属：内置工具有的集中构造，有的与领域状态和运行管理混合；通用 Tool State 机制持有 Todo 的具体定义；Session 同时承担组装和 Plan Mode 的状态实现。这使新增工具、审查依赖和修改生命周期时需要跨多个落点追踪，也容易把目录整理误当成职责重构。

本次目标是建立明确的代码所有权并落实到实现，同时让现有用户、Frontend 和模型继续观察到相同的公开行为。

## Solution

将内置工具及其关联执行、状态和资源能力按能力聚合在 tools 中；同一能力目录内部区分模型协议适配与执行接口，Session 可以直接调用执行接口，负责组装和生命周期协调。Bash、Web Fetch、Todo、Goal、Jobs、Subagent 和 Plan Mode 均集中在各自能力模块；Permission Review 仍归权限模块。通过现有静态检查约束能力内部的依赖方向，让相关修改集中维护。

先保护当前公开协议，再按依赖顺序迁移。工具可用性、输出、事件、存储、权限、取消、恢复和 Frontend 行为保持兼容。

## User Stories

1. 作为维护者，我希望所有内置工具入口有一致归属，以便新增或查找工具时有明确落点。
2. 作为维护者，我希望工具协议与领域行为分开，以便修改模型接口不会混入运行管理。
3. 作为维护者，我希望 Bash 的工具实现集中维护，以便追踪参数、输出和前后台转换。
4. 作为用户，我希望 Bash 前后台继续使用同一执行路径，以便超时转换不会丢失进程或输出。
5. 作为用户，我希望 Bash 的截断、完整输出提示、退出码和取消结果保持一致，以便继续理解命令结果。
6. 作为维护者，我希望 Web Fetch 的请求和转换实现与工具一起维护，以便相关修改集中在一个模块。
7. 作为用户，我希望 Web Fetch 的地址校验、代理、重定向、大小限制与取消行为保持一致，以便重构不改变请求行为。
8. 作为维护者，我希望 Todo 的工具、schema、状态解析和提醒归同一模块，以便避免通用状态机制包含具体业务。
9. 作为用户，我希望 Todo 的清空、提醒和恢复行为保持一致，以便已有 Session 可以继续使用。
10. 作为维护者，我希望 Tool State 机制通过注册接收具体定义，以便新增状态无需修改通用机制。
11. 作为维护者，我希望 Goal 模块拥有状态与续跑规则，以便工具包装变化不影响续跑。
12. 作为用户，我希望 Goal 的人类指令授权、轮次控制与收尾行为保持一致，以便自动续跑不会因重构改变。
13. 作为维护者，我希望 Background Job 工具调用 Session 拥有的 registry，以便只有一套进程与游标管理。
14. 作为用户，我希望模型和 Frontend 的 Job 输出游标保持独立，以便一方读取不会吞掉另一方输出。
15. 作为用户，我希望 Session 结束时继续清理进程组，以便不会残留后台进程。
16. 作为维护者，我希望 Subagent 运行管理返回执行事实，以便模型结果文本由工具统一包装。
17. 作为用户，我希望前台和后台 Subagent 结果保持一致，以便父模型继续正确理解委派结果。
18. 作为用户，我希望同一 Subagent 的消息继续串行投递，以便消息不会因接口拆分发生竞态。
19. 作为用户，我希望父 Run 取消后迟到创建的子 Session 也被收束，以便取消不会遗漏子运行。
20. 作为用户，我希望子 Session 的身份、活动和 Run Outcome 继续区分，以便历史事实不会被误判为当前运行。
21. 作为维护者，我希望 Plan Mode 自己拥有状态切换与失败恢复规则，以便 Session 只协调其执行。
22. 作为用户，我希望父子 Session 继续共享 Plan Mode，以便规划引导保持一致。
23. 作为用户，我希望 Rewind 后 Plan Mode 与所恢复的 Transcript 一致，以便已有子 Session 继续运行时读取正确状态。
24. 作为用户，我希望保存 Plan Mode 失败时状态回退并允许后续重试，以便 Session 不被失败的写入队列卡住。
25. 作为 Frontend 开发者，我希望状态事件回调中再次切换 Plan Mode 能完成，以便不会发生自等待。
26. 作为用户，我希望 Session 关闭和 Run 结束继续等待必要的状态写入，以便恢复时事实完整。
27. 作为维护者，我希望 Permission Review 与权限决策一起维护，以便名称和所有权准确。
28. 作为用户，我希望评审失败、取消和显式规则保持原行为，以便重构不会放宽权限。
29. 作为 Frontend 开发者，我希望包公开导出保持兼容，以便 CLI 和 TUI 无需改变使用方式。
30. 作为模型调用方，我希望工具名称、description、参数 schema 与顺序保持一致，以便模型接口不会随目录迁移改变。
31. 作为用户，我希望缺少 Interaction 回调时工具继续隐藏或使用原安全默认，以便 Headless CLI 不出现无法完成的交互。
32. 作为用户，我希望子代理类型限制、fork 继承和 MCP server 过滤继续生效，以便委派范围保持一致。
33. 作为模型调用方，我希望每轮工具刷新和 Subagent 类型描述保持及时，以便模型不会看到过时能力。
34. 作为维护者，我希望 Hook 仍能构造独立只读工具集，以便复用真实工具能力进行模型检查。
35. 作为维护者，我希望 MCP 复用错误包装时不依赖工具组装入口，以便避免不必要的耦合。
36. 作为用户，我希望错误码和参数继续进入工具结果与 Transcript，以便显示和恢复保持一致。
37. 作为维护者，我希望静态检查拒绝明确的反向依赖，以便目录约定不会只依靠记忆。
38. 作为维护者，我希望合法的 Hook 和 MCP 工具消费被明确允许，以便检查规则不会误伤真实职责。
39. 作为维护者，我希望现有公开测试保护生命周期，并补齐真实的协议与时序缺口，以便无需测试私有实现。
40. 作为维护者，我希望每个实施阶段可运行并有验证证据，以便能定位回归而不依赖最后一次集成。
41. 作为用户，我希望已有 Transcript、Session Resume、Compaction 和 Rewind 保持兼容，以便继续使用已有对话。
42. 作为用户，我希望 TUI 的视觉、交互与 CLI 输出保持一致，以便内部重构不改变操作体验。
43. 作为维护者，我希望 Goal、Jobs、Subagent 和 Plan Mode 的协议与执行能力在同一目录，以便一次能力修改集中维护。
44. 作为调用方，我希望 Session 可以直接使用 tools 中的状态与资源接口，以便无需伪造模型工具调用。
45. 作为维护者，我希望 tools 中的执行能力不依赖 Frontend 实现，以便 CLI、TUI、模型与测试共用一份 Agent Core 行为。

## Implementation Decisions

- tools 表示内置工具及其关联能力的集合，按能力聚合实现；不再只表示模型协议层。能力入口同时提供执行接口和模型工具工厂，Session、MCP 和 Hook 按真实用途消费。
- 每个能力内部的协议适配负责名称、label、description、参数 schema、参数适配、结果文本、content、details、isError 和工具终止标记。执行模块拥有操作不变量、状态变化、并发、持久化义务和资源生命周期，返回执行事实与现有 RunResult 等事实类型。两者同目录但职责分开。
- Bash、Web Fetch 和 Todo 分别作为工具模块内部的完整实现维护。Todo 的 schema、版本解析与提醒由该工具模块提供给 Session 注册，通用 Tool State 不内置或转导出 Todo。Todo 不新增顶层领域模块或无用途的 controller。
- Goal 的 controller、状态、续跑提示与模型协议适配同属 Goal 能力目录，内部保持接口分工。续跑、收尾上下文仍归 Goal 执行能力，不能把所有模型文本一概视为工具结果。
- Background Job registry 保留统一的启动、读取、停止与清理接口。Bash 前台与后台共用进程组执行路径，继续复用锁定 pi 的输出采集与截断能力。
- Subagent 的运行管理、类型和工具适配同属 Subagent 能力目录，提供当前委派、fork、发送、列举与类型查询所需接口。运行名额在等待创建子 Session 前预留；取消、每个 child 的发送串行化、结算、通知、使用量和恢复身份归执行模块。动态工具描述由最新类型事实构造，保留当前名称顺序与刷新时机。
- Plan Mode 的状态、controller、提醒与 Enter/Exit 工具适配同属 Plan Mode 能力目录。controller 拥有 active、hasEntered、revision、写入队列、失败回退、恢复投影和等待写入的接口。hasEntered 依据是否存在状态快照，不从 active 推导。父子 Session 共用同一 controller，子 Session 不新增状态快照。
- Session 注入 Plan Mode 状态读取与持久化回调，继续协调 baseline、Session Store、状态事件、Run 外缓存和 Run 开始交付。状态写入队列不等待事件通知；原调用仍等待自己的通知完成，回调再次切换状态不会自等待。Rewind 和关闭保持原有等待位置及恢复顺序。
- Session 仅抽取内部工具组装协作，保留 Run 调度、恢复流程、事件和资源生命周期。工具组装不持有第二份 Session 状态，不引入一个接收全部能力的大工厂。
- MCP 连接、授权、配置诊断和 Session 快照协调继续归 Session/MCP，包含 McpSnapshot、McpToolView、McpConfigError 公开类型与 mcpServers({ refresh })、authenticateMcp、clearMcpAuth、reconnectMcp 接口。快照是 Agent Core 状态事实；面板选择、焦点和输入仍归 Frontend。工具组装不接管快照缓存、revision、独立 probe 或管理互斥状态。
- 保留 MCP 快照的独立副本、配置来源、URL 脱敏和原始工具 schema；缓存读取不重连，显式刷新替换完整快照且共享并发 probe。先提交再发送 mcp_servers_changed，相同快照不重复通知，较旧 probe 不覆盖较新 Run 状态，单 server 管理不抹去其他 server，dispose 中止操作并关闭资源且不发布迟到事件。
- 子 Session 继续传递 MCP OAuth Interaction 的 child origin，授权后按原继承范围刷新真实工具并共享现有凭据归属；显式 type.tools 保持精确白名单，包含 authenticate-only 类型，Headless 子 Session 不暴露授权工具。子 Session 构造与授权回调协调仍归 Session。
- 保留启动、Run 前和 Turn 准备时不同的工具刷新范围与顺序。Question、Plan Mode、Goal、Subagent 的可用性、子类型过滤、fork 工具继承、继承 MCP server 与动态类型描述均按当前行为构造。
- Permission Review 作为权限模块中的独立模型评审实现，保留失败转 ask、取消、安全默认与显式规则约束。Plan Mode 与 Permission Mode 继续独立。
- 当前实际共用的 pi 适配与错误包装从工具组装入口分离。MCP 可消费错误包装，Hook 可消费独立只读工具集；Session 可直接调用能力入口提供的 controller、registry 与状态接口。
- 依赖方向为 Session 调用能力接口与工具工厂、能力内部的协议适配调用执行模块、执行模块调用通用机制。执行模块不反向导入自身协议适配或全局工具组装入口；跨能力使用所属能力入口，例如 Bash 调用 Jobs registry。通用状态机制不依赖 Todo 等具体定义。
- 用现有 Oxlint 文件范围和导入限制约束明确的能力内部反向依赖及通用状态对具体定义的依赖，允许 Session、其他能力、MCP 和 Hook 的真实消费。不再禁止领域模块导入整个 tools。验证实际违规会被拒绝、合法使用可通过。该机制限制导入路径及名称，不宣称已经验证完整传递依赖图，不新增检查框架。
- 包公开导出、工具调用协议、结果与错误详情、事件、Frontend 表现和持久化格式保持兼容。所有内部消费者同时迁移，删除旧归属与废弃内部转导出。领域概念不变，无需为工程目录新增领域术语。
- 本次明确的所有权约定已记录为架构决策，现有混合落点按实施依赖逐步迁移。现行 harness、存储、Subagent 恢复、权限和 locale 约束继续适用。

## Testing Decisions

- Q11 已确认测试接缝：首选公开 createSession 与现有 fake model；通过模型可见声明、工具结果、Session 查询、事件、Transcript 和恢复后事实断言行为。复用 Frontend 现有应用入口保护实际消费，不新增内部控制器测试接口。
- 先固定未重构版本的工具名称、description、完整 parameters schema 和工具顺序，覆盖顶层、缺少 Interaction 回调、普通及 fork 子 Session、类型过滤和动态刷新。label 等非模型声明字段保留原值，通过已有事件或呈现测试保护。
- 使用确定的临时项目、类型定义、隔离 homeDir 与现有模型回复 helpers。随机 Session 标识与路径验证关联事实，不写入机器相关的静态协议基线。同步使用明确事件、完成信号和终端谓词。
- 结果、事件、错误码、持久化、权限、Hooks、取消和资源清理由已有公开测试保护，避免重复创建全量结果快照。测试先于对应实现变动通过；不得修改原断言迁就重构。
- Plan Mode 重点保护乐观内存状态、串行写入、最新 revision 回退、失败后重试、队列与通知边界、同值等待、父子共享、Compaction、Rewind 及关闭等待。核查并补齐多个待写 revision 的失败组合，以及父 Rewind 后已有子 Session 继续 send_message 的状态共享。
- Subagent 重点保护前后台结果、创建前名额预留、迟到创建的取消收束、发送串行、类型变化、错误与通知、fork、恢复、Run Outcome 和使用量结算。
- MCP 快照、刷新、事件提交顺序、管理互斥、probe 与 Run 竞态、副本隔离、配置诊断及 dispose 复用 mcp-api.test.ts；配置与 OAuth 生命周期复用 mcp-config.test.ts、mcp-oauth.test.ts 和 mcp-oauth-lifecycle.test.ts。普通/fork 子 Session 的 child origin、授权后工具刷新、凭据共享、取消及精确白名单复用 subagent-mcp-oauth.test.ts。先验证既有用例，仅为真实缺口增加测试。
- Bash、Background Job、Web Fetch、Todo、Goal、Permission Review、MCP 和 Hook 沿用现有公开场景，覆盖生命周期和执行协议而非目录或私有状态结构。
- 测试 prior art 包括 tools、Plan Mode、Plan Review、Enter Plan Mode、Todo 与提醒、Goal 工具、Subagent 与 fork、类型和恢复、Background Job 与 Session Job API、通知与子 Jobs，以及 Web Fetch 的请求、重定向、代理、转换和权限套件。
- 每票运行受影响公开测试、格式、lint 与类型检查。最终以隔离配置、清除 NO_COLOR 运行完整 bun run check，覆盖全部包、CLI/TUI 和 Knip；按仓库规则报告真实命令、退出码、测试结果和局限。
- lint 规则通过受控临时违规输入验证命中并验证合法例外，清理临时文件。它是规则验证，不增加镜像实现的业务测试。
- 若当前基线已有真实失败，记录并区分既有行为问题和重构回归；受影响票不能标为验证通过，行为修复单独处理。

## Out of Scope

全面重写 Session、Run 调度或恢复机制，替换 pi harness，新增通用 controller 框架、运行单位、依赖检查框架或 provider，改变工具协议、权限语义、Transcript schema、Frontend 视觉和交互，保留无证据需求的旧内部路径兼容层，新增顶层 Todo 模块，以及把现存行为问题混入结构迁移。

本规范不授权生产代码实现、提交、合并或 worktree 清理；执行和 Git 范围由后续实施请求决定。

## Further Notes

用户以 to-spec 确认将 Q1–Q11 和完整设计转为正式规范，随后明确调整 tools 的含义，将 Goal、Jobs、Subagent、Plan Mode 的关联能力一并聚合到 tools。最新调整覆盖此前要求外层领域目录与工具入口分离的目录决策，保留内部职责和公开契约。

2026-10-07：01–07 已实施并集成（集成点 `ba200b7`），08 完成 Standards/Spec 审查、契约兼容核对、MCP 验收、边界核对、删除审计与文档核对，并修复了 Oxlint 的"全局工具组装入口"约束指向已删除路径的缺陷（[票 08](issues/08-final-review-and-verification.md)）。八票均为 `resolved`；合并结果 `587457a` 上的 `env -u NO_COLOR bun run check` 退出码 0，`oxfmt --check` 694 文件、`oxlint` 398 文件 0/0、`tsc -b`、`knip` 通过，测试 2497 pass / 0 fail（14040 expect，179 文件）。

实施严格按 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08。每票更新当时的所有消费者与相关当前文档，保持可运行，不留待下票修复的破坏。

2026-10-07 重新审计代码基线 182d278；审计时的规划提交 55db4ca 与该基线之间无 apps/、packages/ 代码差异。MCP 快照与子 Session OAuth 的既有契约纳入本次兼容验收，不改变 tools 的能力聚合决策。审计运行 `rtk proxy bun test packages/agent/tests/e2e/mcp-api.test.ts packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts packages/agent/tests/e2e/subagent-mcp-oauth.test.ts packages/agent/tests/e2e/job-api.test.ts packages/agent/tests/e2e/subagent-jobs.test.ts`，退出码 0，7 个文件、112 项通过、0 失败、654 次断言。该证据属于迁移前专项审计，不表示实施票已完成或全量检查已通过。

- [01：公开协议与时序基线](issues/01-public-contract-baseline.md)
- [02：工具适配与基础工厂](issues/02-tool-runtime-and-factories.md)
- [03：工具归属与 Permission Review 迁移](issues/03-tool-ownership-migration.md)
- [04：Goal 能力聚合与内部协议分离](issues/04-goal-tool-separation.md)
- [05：Subagent 能力聚合与工具适配](issues/05-subagent-tool-separation.md)
- [06：Plan Mode 状态控制提取](issues/06-plan-mode-controller.md)
- [07：Session 工具组装与依赖约束](issues/07-session-assembly-and-boundaries.md)
- [08：最终审查和验证](issues/08-final-review-and-verification.md)

长期约定见 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)。目标目录与接口解释见 [设计参考](design.md)，决策过程见 [访谈记录](interview.md)；实施范围与验收以本规范和工单为准。
