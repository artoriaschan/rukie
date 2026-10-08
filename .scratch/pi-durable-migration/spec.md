Status: resolved

# Spec: pi 1.0.4 与 pi-durable 全面迁移

## Problem Statement

Rukie 当前依赖 pi 0.99.2 的 Agent loop 与旧 harness。pi 1.0.4 已删除项目使用的旧 harness 存储、工具、skills、compaction 与环境入口，无法只修改版本号完成升级。维护者希望使用新的 durable 执行模型，让用户在进程退出或中断后恢复已接受而未完成的工作，同时继续使用 Rukie 的权限、工具与 Frontend 能力。

继续保留旧调度与存储兼容层会形成两套执行规则，增加生命周期、工具副作用和恢复行为的维护成本。本次接受实验性依赖和 API 破坏性变化，不兼容旧 Session 数据。

## Solution

全面采用 pi-durable 作为 Agent Core 的执行与持久化基座，移除 pi-agent-core。以 durable 的提交、任务 ownership、调度、压缩、事件、取消与恢复语义为准；Frontend 恢复所选 Session 后继续其中未完成的工作。Rukie 自有能力保留，通过 extensions、hooks、documents 与 durable tasks 接入，不维护旧 Agent loop 或恢复引擎。

采用 durable 原生 JSONL 目录存储，旧文件保留但不加载、不枚举、不迁移。子代理默认作为后台工作运行，父 Run 可以先结束。Headless CLI 等待本次请求产生的后台工作及结果处理完成后退出；TUI 正常退出保留未完成工作，Esc 取消当前工作且默认不穿透后台边界。中断的审批与提问按当前配置重新判定并重新发起。

## User Stories

1. As a Rukie maintainer, I want all required Pi packages pinned to 1.0.4, so that the runtime uses one deliberate dependency baseline.
2. As a Rukie maintainer, I want pi-agent-core removed, so that there is one execution engine to maintain.
3. As a Rukie maintainer, I want Bun feasibility established first, so that later migration work rests on tested runtime behavior.
4. As a Rukie user, I want accepted inputs committed before execution becomes visible, so that a restart retains the work I submitted.
5. As a Rukie user, I want an unfinished Session to resume automatically when I reopen it, so that I can continue interrupted work.
6. As a Rukie user, I want a new process to recover unfinished model work, so that recovery does not depend on old in-memory objects.
7. As a Rukie user, I want interrupted unsafe tool calls reported as interrupted, so that recovery does not blindly repeat external effects.
8. As a Rukie user, I want replay-safe tools to reuse committed identities, so that a restart does not create duplicate logical work.
9. As a Rukie user, I want completed tool results retained after restart, so that the model can continue from recorded facts.
10. As a Rukie user, I want partial output restored from committed state, so that interruption does not erase useful progress.
11. As a Rukie user, I want old Session files left untouched, so that installing the new runtime does not destroy my old records.
12. As a Rukie user, I want the Session picker to show only supported new Sessions, so that selecting a Session has predictable behavior.
13. As a Rukie user, I want normal TUI exit to preserve pending work, so that I can resume it later.
14. As a Rukie user, I want Esc to cancel the current ordinary ownership scope, so that I can stop foreground work.
15. As a Rukie user, I want background subagents to survive parent cancellation as pending work, so that independent delegation is not discarded.
16. As a Rukie user, I want an explicit stop action to cancel a selected subagent, so that I can end delegation deliberately.
17. As a Rukie user, I want a background subagent to let its parent Run finish, so that delegation follows the durable background model.
18. As a Rukie user, I want unfinished subagents to resume with their original identities, so that reopening a Session does not create duplicate children.
19. As a Rukie user, I want child results delivered through persistent notifications, so that restart does not lose a completed answer.
20. As a Rukie user, I want a child result reported once logically, so that recovery does not duplicate follow-up inputs.
21. As a Headless CLI user, I want the process to wait for work caused by my request, so that its final output includes subagent result handling.
22. As a Headless CLI user, I want unrelated work and idle subagent handles excluded from that wait, so that the command can finish.
23. As a Headless CLI user, I want active work preserved when I interrupt the process, so that a later resume can continue it.
24. As a Headless CLI user, I want text and stream-json output to distinguish parent completion from request settlement, so that automation can interpret completion correctly.
25. As a Rukie user, I want unfinished approvals and questions presented again after restart, so that interruption cannot be mistaken for consent.
26. As a Rukie user, I want resumed execution evaluated against current permission rules and project trust, so that old transient grants do not bypass current decisions.
27. As a Headless CLI user, I want unavailable interactions to take safe defaults, so that unattended runs do not wait for an absent user interface.
28. As a Rukie user, I want Hook behavior retained under durable lifecycle hooks, so that existing configured checks remain useful.
29. As a Rukie user, I want Plan Mode independent of Permission Mode, so that planning guidance does not silently change authorization.
30. As a Rukie user, I want Todo, model selection, Plan Mode and Goal facts restored, so that work continues with the correct state.
31. As a Rukie user, I want active Goal continuation recovered without duplicate rounds, so that restart preserves progress and limits.
32. As a Rukie user, I want paused, blocked and completed Goals to remain stopped, so that recovery does not reopen settled work.
33. As a Rukie user, I want automatic and manual Compaction supported by durable, so that long Sessions can keep working.
34. As a Rukie user, I want original Transcript entries retained through Compaction, so that the compressed model context is not the only record.
35. As a Rukie user, I want Checkpoint and Rewind retained, so that I can restore code, conversation or both.
36. As a Rukie user, I want Rewind to preserve the abandoned conversation, so that recovery does not erase historical facts.
37. As a Rukie user, I want file-change reminders and known-content baselines committed together, so that the model is not credited with unseen changes.
38. As a Rukie user, I want read, write, edit, grep, glob, skills and web fetch retained, so that migration does not remove my coding tools.
39. As a Rukie user, I want image input and image reads retained across resume, so that switching harness does not reduce model-visible evidence.
40. As a Rukie user, I want bash and Background Job management retained, so that foreground-to-background transitions and output remain usable.
41. As a Rukie user, I want process resources cleaned up on host exit, so that durable task recovery is not confused with restoring old OS processes.
42. As a Rukie user, I want MCP tools and OAuth retained, so that my configured servers continue to work with user-owned credentials.
43. As a Rukie user, I want Side Question, Session titles and usage reports retained, so that migration preserves supporting features.
44. As a TUI user, I want recovered state, streaming updates and background activity displayed accurately, so that parent idle is not mistaken for all work being finished.
45. As a TUI user, I want resize, focus, reading position and terminal restoration preserved, so that the new runtime does not regress terminal behavior.
46. As a Rukie maintainer, I want public behavior tests and current documentation to agree with durable, so that obsolete compatibility assertions do not define the new runtime.

## Implementation Decisions

- **依赖与替换范围。** 所需 pi-ai、pi-mcp、pi-durable、Chord 及解析到的 Pi 支撑包精确对齐 1.0.4；更新锁文件和技术栈说明。移除所有工作区对 pi-agent-core 的直接依赖、旧 harness 入口、私有路径解析和废弃适配。只引入实际消费的直接依赖，TypeBox 与目标 Pi 版本保持一致。接受 API 重写，所有仓库消费者同步更新，不保留旧接口 shim、旧执行路径或 pi-coding-agent SDK。
- **运行时责任。** durable Harness 拥有提交、generation、工具任务、ownership、调度、原子提交、恢复和原生 Compaction。Session 作为 Frontend-facing 能力入口，组装配置、环境、extensions、观测和交互，不再自行运行第二套模型循环。模型、provider、自定义模型、代理和凭据设置继续由 Rukie 配置模块提供给 pi-ai。
- **领域映射。** Rukie Session 仍表示同一工作目录的用户对话；其执行映射到 durable Conversation，父子关系归属同一 Harness 的持久化任务图。durable 的 Session/Harness 是底层存储与任务容器，不替换产品术语。Run/Turn 依原生执行边界定义，后台任务不阻止父 Run 结束；Frontend 的整次请求结算是另一项完成条件。
- **新存储。** 使用原生 JSONL storage directory，记录包含主提交文件与 document/task sidecars。采用独立新根目录，按项目组织，稳定 Session 索引、Conversation 身份和父子 ownership 一同保存。旧目录不参与枚举、resume 或写入；显式指定旧 id 时给出可理解的“不支持旧格式”或“找不到新版 Session”结果。不开历史文件探测或自动升级路径。
- **提交与访问。** 同一 storage 由一个宿主进程独占；在宿主入口保证重复打开被拒绝，处理失效持有者，不把上游未提供的跨进程锁描述为原生能力。JSONL 启用 fsync；提交成功后发布用户可见事实，落盘失败向调用方传播，不继续发布成功或推进模型已知状态。关闭等待提交与资源收束，保存可恢复的 pending work。
- **状态和上下文。** Todo、Goal、Plan Mode、模型选择、子代理身份、Checkpoint 和文件跟踪等由所属能力定义 typed documents。按用途选择 latest、rewindable 和 fork 策略；不再从旧 Tool State 消息快照恢复。Transcript 仍是追加的事实，当前模型上下文按 durable 的 reset、fork 和 Compaction 投影，不能把 view entries 或当前消息列表等同于全部历史。需要模型感知的状态通过可追溯提醒或原生 prompt sections 呈现。
- **恢复与重放。** 安装原运行所需 extensions 后，打开所选 Session 对应的 Harness 并启动原生恢复；列表、预览与只读查询不启动调度。恢复已持久化而未结算的任务及通知，不因为存在任意历史事实新建工作。已提交请求使用稳定 requestId 去重。已进入执行阶段的工具只在已存 intent 与当前定义都声明 safe 时重跑；其余按原生 interrupted 处理并保留已提交输出。内置工具默认不扩大 safe 范围，MCP、bash、文件写入及外部 Hook 不因名称或“可读”判断被自动标为安全。
- **交互与权限。** Rukie 继续拥有 Permission Decision、Permission Review、Trusted Project、Claude Code Hook 协议、问题、Plan Review 和 MCP OAuth。原生 hooks 不等于现成交互协议；恢复需要宿主 extension 保存请求事实、阶段和失效身份，在打开时依据当前规则重新判定并重新发起未完成交互。进程内回调与临时 allow 不恢复；晚到旧回复不得推进新阶段。所有恢复后实际执行的路径仍接受当前授权检查，safe replay 不绕过规则。Headless 不提供 Interaction 回调，依赖交互的模型工具仍隐藏，Core 自发请求取安全默认值。
- **自有能力。** 保留 read/write/edit、grep/glob、skills、web fetch、图片、bash/jobs、Todo、Goal、Subagent、Plan Mode、Checkpoint/Rewind、Side Question、标题、context/usage 报告及 MCP 管理。已有能力模块拥有执行与状态，协议适配改为 durable tool/extension 接口；不新增统一大 controller。原生 read 尚不支持图片，需要保留 Rukie 的图片读取扩展。必要输出截断由公开能力或所属实现承担，禁止继续解析被删除的旧 harness 私有文件。
- **后台子代理。** 默认采用 durable background anchor task 与 owned child Conversation，子代理继续受类型、工具、权限和项目信任限制，默认不能再创建子代理。创建、send_message、fork、结果 reporter 使用稳定身份与 requestId；后台子代理可以跨 close/重启恢复，父 Run idle 或 Esc 不终止它。显式子代理停止取消相应 ownership scope。持久化 reporter 在结果可用后提交 follow-up input；恢复时复用任务和 child，不能复制创建或重复投递已结算通知。
- **Headless 完成边界。** 跟踪本次输入或 Goal 启动所产生的提交、后台子代理 Run、通知及后续处理，直到这些工作结算才输出终态并退出。等待必须包含通知后新增的处理，不能只对初始任务集合或父 idle 采样；空闲长期 anchor、历史子代理身份和无关 Session 工作不属于等待对象。内部 parent Run 结束仍是原生结束，不通过旧父 Run 等待逻辑伪装为一个长 Run。text 最终输出包含已完成结果处理后的回答；stream-json 可以提前流式发布事实，但只有整个请求结算后发布最终完成记录。主动中断走 close，退出状态明确表示未完成。
- **关闭与取消。** TUI 正常退出、Headless 主动中断采用 close：保留任务，取消当前 invocation，等待关闭并释放宿主资源。Esc 使用 Conversation 原生 abort，默认不穿透 background boundary；显式停止子代理取消对应任务。close 后没有执行进程继续工作，下一次打开才恢复；不引入常驻 daemon。Background Job 是 OS 进程资源，与 durable Task 不同，关闭仍清理，Resume 不重建进程或盲目重跑 bash。已结算 bash 创建的 Job 也不能因持久化任务记录被显示成活进程。
- **Goal。** 将自动续跑表达为 durable 的持久化任务与提交，恢复现存活跃任务，去掉“仅当前进程 armed”的阻断与独立调度器。暂停、受阻、完成、轮次耗尽或已取消的目标不因为有历史 Goal document 自动重新启动；模型不能借恢复获取新的授权。实际轮次、提交和结束事实原子关联，重启不重复计数、突破上限或重复发 prompt。显式 Esc 按取消语义结束当前普通工作，后续需显式恢复已停止的 Goal。
- **Rewind。** 保留真实用户输入锚点及 write/edit 首次修改前的文件备份；内部提交和通知不另建 Checkpoint。通过原生 fork/context 与 rewindable document snapshots 建立恢复后的对话，保留原历史，移除旧 main branch tip 操作。恢复旧位置本身不复制或重新激活后来产生的任务；代码与对话双恢复先校验和恢复文件，失败不切换对话。父子仍有活跃工作时拒绝 Rewind，避免后台任务在新上下文下继续写入；文件外部副作用不属于撤回范围。
- **观察与呈现。** Frontend 使用 durable committed views/events 的一致快照与增量更新，处理慢订阅者收到的新 snapshot、部分输出、task status、队列和 Compaction。Rukie 公开事件与输出协议可破坏性更新，但同一版本的所有消费者与文档必须一致。Frontend 不导入具体执行器，Agent Core 不做本地化，当前目录依赖方向继续受约束。TUI 沿用已合并的固定来源 dsh ink，经公开组件与 hooks 接入；应用继续拥有 immutable RGBA 的解码/缩放/裁切，renderer 拥有终端图形与资源。迁移不重建旧 renderer 接口；确需局部 runtime 修改时维护固定来源 diff 和本地改动记录。
- **实施方式。** 先完成隔离的目标依赖最小验证，再在同一迁移交付范围按票据依赖实施。每次接口变更更新当时消费者，不交付兼容 shim、空实现或两个生产执行引擎。各票记录能力测试与尚未完成的集成范围；全部能力、Frontend、文档与最终检查通过后才把整项标为已交付。

## Testing Decisions

- 用户已确认测试入口：最高主入口是公开 Session API，沿用假模型、隔离 cwd/homeDir、可控回复和事件同步；Frontend 补充现有 TUI start/startWithClock 与 Headless main/进程入口。可以重写 helpers 以适配目标 pi-ai，不保留旧私有 types 作为测试替身。
- 好的测试观察已提交输入、模型请求、工具副作用、公开输出、恢复后状态与资源结束；不比较内部 task 调度器结构、不以函数被调用代替行为成立、不把历史 JSONL 字段作为新格式契约。request scope 等必要新观测通过公开 Session 能力暴露，不给每个能力加测试专用入口。
- 既有 prior art 包括 Agent Core 的 async-hooks、权限与路径规则、Goal、checkpoint 与 checkpoint-subagents、MCP OAuth/lifecycle、subagent 与 jobs、文件变化和图片 e2e；Frontend 的 headless main/CLI、TUI resume/mixed-session-resume、exit-resume、permissions、streaming-burst 与受控时钟 helpers。更新因旧语义失效的断言，保留自有能力、授权与用户可见行为覆盖。
- 基座验证覆盖 Bun 下 open/submit/wait/watch/close/reopen，原生 JSONL/fsync，假模型、真实工具调用、异步 beforeTool，以及自有能力所需的环境 API。试验在隔离环境中，不安装到真实用户配置或把试验结论冒充生产迁移完成。
- 恢复矩阵覆盖：提交后尚未请求模型、模型流中断、已完成模型响应、工具 intent 已提交但结果未提交、safe replay、unsafe interrupted、工具结果已提交、子代理创建、child 结束但 reporter 未结算、通知已提交但父后续处理未完成。对相同 requestId 反复打开，验证逻辑工作不重复，副作用与恢复策略符合原生规则。
- 权限与交互覆盖：审批、问题、Plan Review、OAuth 等待期间 close/reopen，失效回调晚到，规则或 Trusted Project 在重启间变化，safe replay 的当前规则检查，无回调、拒绝和取消。不得把审批过程恢复等同于业务工具可安全重放。
- 持久化覆盖：documents 的清空/版本校验、fork/rewind 策略，Compaction、图片原始块、模型切换、提醒与文件基线原子提交失败、partial output、慢订阅者 snapshot 与重复恢复。只读列表及预览不得启动模型请求或改变任务状态。
- Frontend prior art 以当前 dsh ink 公共入口为准：TUI 使用 start/startWithClock 与 Unicode grapheme headless terminal，绘制完成通过 terminal I/O callback/flush 观测，renderer 结束通过 unmount、waitUntilExit 与 cleanup 收束。Session close 与 renderer 退出分别等待真实完成，终端恢复不代表存储已关闭。保留现有选择/复制、源位置、底部跟随、RGBA 图形及同批输入行为，不将旧 primitive/event union 或旧 renderer options 带回迁移适配。
- Hook 真实进程清理沿用当前 post-tool-hooks 的原子 ready-file/PID 发布与 filesystem completion 信号，覆盖 shell 及子进程已启动后的取消；timeout 是失败边界，不重新引入固定 cleanup 等待。
- 生命周期覆盖：后台 child 在父 idle/Esc 后继续；显式 child abort；close 保留且停止当前进程；Headless 等待因果关联的 child/reporter/follow-up，排除空闲 anchor/无关工作；SIGINT/SIGTERM 后退出并可恢复；TUI 正常退出和小终端恢复。Background Job 使用真正的子进程契约验证清理，不假设父进程虚拟钟可以驱动子进程。
- 时间与成本：TUI 沿用 startWithClock 与当前 Sinon-backed testClock，覆盖 Date、timeout/interval 和 performance，真实 I/O 与 setImmediate 继续作为完成信号，不恢复已移除的 Bun jest 虚拟钟路径。同进程 timer 使用虚拟钟和 deadline 前/到时断言；异步同步用提交/任务结算/模型屏障/terminal predicate/进程 exit，并带失败边界。真正重启、传输或 OS 清理才使用真实时间，在等待旁说明原因。检查大于一秒用例的启动、渲染和 cleanup 成本；迭代跑聚焦用例，最后一遍 aggregate 即为整次实现交付依据。
- 代码交付最终执行清除 NO_COLOR 的完整 bun run check，包含所有 tests；后续生产变更才重新执行。当前 to-spec 与规格刷新仅检查文档、工单结构、格式、链接和 diff，不运行业务测试，也不宣称目标 durable 的 Bun 可行性已经验证。当前 aggregate 的静态阶段包含 ink AST 依赖边界检查，不能只靠 vendored 目录的 lint/Knip 豁免判断边界成立。

## Out of Scope

- 旧 Session 数据兼容、迁移、导入、格式探测、旧 API shim，以及旧执行引擎 fallback。
- 新增 pi-coding-agent SDK、更换 TUI renderer、视觉重设计、产品改名或重新设计权限/Plan Mode 的产品含义。
- 本次实现桌面 Frontend 或 SQLite 后端；保留未来采用原生 Storage 抽象的空间。
- 常驻 daemon、跨机器运行、多宿主写同一 storage、跨进程任务调度、OS Background Job 恢复，以及对任意外部副作用的 exactly-once 承诺。
- 为本次规格直接升级依赖、实现生产代码、运行模型服务、发布、提交、合并或清理 worktree；这些由后续实施请求授权。

## Further Notes

### 已确认的决策

Q1–Q3：全面 durable，接受实验性与 API 破坏；执行逻辑按 durable，恢复未完成工作；不兼容旧数据。Q4–Q6：自有能力保留，新原生 JSONL，默认后台子代理。Q7–Q9：Headless 等待请求产生的后台工作及结果处理；退出 close、Esc abort；中断交互重新判定/发起。用户调用 to-spec 授权落规格，随后确认继续沿用上述公开测试入口。

### 当前事实与证据边界

2026-10-07 初次规格基线为 e8628b33；代码更新后，当前刷新基线为 92d17ca1，Bun 实测为 1.4.2。Agent Core 的直接运行依赖仍为 pi-agent-core、pi-ai、pi-mcp 0.99.2；coding-agent 的 agent-core 与 ai 是直接 devDependencies，供测试使用，不能描述为其生产依赖。相对初次基线，Agent Core 生产源码与 Headless 入口/测试未变化，Agent Core 的 post-tool-hooks 测试改为原子 readiness 信号；TUI 已采用 dsh ink，相关应用、测试与终端依赖已更新。当前 Session 仍使用 Agent hooks、消息数组、旧 Branch/Entry/JsonlSessionRepo 与旧输出采集路径。已读取 npm 精确 1.0.4 包的 exports、README 与相关源码：agent-core 存在但仅剩核心 Agent/loop；durable 不依赖它，提供原生存储与运行任务；read/write/edit/bash 未声明 replay，缺省为 unsafe；图片 read 需宿主扩展；JSONL 缺省不启用 fsync，也未提供跨进程锁。

上游参考：[旧 harness 删除提交](https://github.com/earendil-works/pi/commit/7fd478a2e888ebc28869566f33a186303d372838)、[pi-durable 1.0.4 发布包](https://www.npmjs.com/package/@earendil-works/pi-durable/v/1.0.4)、[durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)。实施以精确 1.0.4 发布源码为准，main 文档可能继续变化。当前尚未运行目标依赖的 Bun 试验或任何迁移业务测试，01 是执行可行性的交付门槛。

### 已合并代码对实施的影响

[ADR-0013](../../docs/adr/0013-adopt-dsh-tui-ink.md) 已 accepted，固定采用 dsh-TUI 来源 3c89ea516e4f7d2777efe979200016528722a0b4 的 ink/Yoga；它已替代 ADR-0005 的自研渲染管线。当前公开组件、hooks、immutable RGBA 与 root 退出义务见 [ink README](../../packages/coding-agent/src/ink/README.md)。TUI start 仍为应用入口；startWithClock 改为包装 Sinon testClock，terminal helper 采用 Unicode grapheme 及统一颜色/I/O 完成处理。根 check:dev 已纳入 check:ink-boundaries 的 AST/module resolution 检查。实施以这套已合并 API 与验证入口为基线，不复活旧 renderer 或重做已完成的 dsh ink 工作。

### 领域定义调整方案

此表是迁移后的定义要求，不将尚未实施的行为写入当前 CONTEXT 或运行参考。实施时同时更新拥有该行为的定义与文档。

| 术语                                       | 迁移后的定义要点                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| Session                                    | 产品对话及可恢复身份；底层容器名不改变产品用语                             |
| Run / Turn                                 | 按 durable 原生处理输入与模型调用边界；后台子代理不延长父 Run              |
| Session Resume                             | 打开对话并恢复其中未结算的持久化工作；只读预览不恢复执行                   |
| Transcript                                 | 追加的已提交事实；当前上下文是其投影，保留 fork/reset/Compaction 前历史    |
| Tool State                                 | 可恢复的能力事实，由 typed documents 保存，按需要支持 rewind/fork          |
| Subagent / Subagent Activity / Run Outcome | 后台子 Conversation 及持久化活动；终态不是委派任务验收结论                 |
| Goal                                       | 目标事实与可恢复续跑工作分开表达；活跃任务恢复，已停止目标不自动重启       |
| Interaction                                | Frontend 回应一次请求；未完成请求恢复需重新判定，旧回调不再有效            |
| Rewind                                     | 恢复文件及/或对话位置，保留旧历史，不复制旧任务活动                        |
| Background Job                             | 当前宿主的 OS 进程资源，不等于可恢复的 durable Task                        |
| Session Store                              | 原生 durable storage directory 与索引，不再是旧 session repo/单 JSONL 文件 |

### 实施票据与顺序

1. [01：Bun 与目标依赖可行性](issues/01-bun-feasibility.md)
2. [02：运行基座与公开接口](issues/02-runtime-and-api.md)
3. [03：原生存储、documents 与上下文](issues/03-storage-and-context.md)
4. [04：权限、Hook 与交互恢复](issues/04-permissions-hooks-interactions.md)
5. [05：工具、自有能力与资源](issues/05-tools-and-resources.md)
6. [06：后台子代理与持久化通知](issues/06-subagents-and-reporters.md)
7. [07：Goal 的可恢复续跑](issues/07-durable-goal.md)
8. [08：Frontend 恢复与退出](issues/08-frontend-lifecycle.md)
9. [09：文档、审查与最终验证](issues/09-delivery-gate.md)

严格按依赖推进；准备阶段的聚焦验证不是最终迁移验收。01 若发现确实无法满足本规格的阻碍，附可复现证据，不擅自降级回旧 harness 或删除能力。其余局部实现选择遵循本规格和仓库规则，不重新打开已经确定的产品决策。

## ADR Coverage

| 决定或修改                                            | 归属                                                                                                                                                                                                                                                                                                            | 理由                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 采用原生 durable harness，允许 API 破坏，旧数据不兼容 | 新增 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)，替代 [ADR-0002](../../docs/adr/0002-reuse-pi-agent-core-harness.md)                                                                                                                                                                           | 唯一运行引擎及长期升级成本改变                         |
| 原生 JSONL 目录、单宿主访问及 Storage 抽象            | ADR-0024，部分替代 [ADR-0003](../../docs/adr/0003-dual-session-store.md)                                                                                                                                                                                                                                        | 后端选型保留，旧 repo 与单文件格式失效                 |
| 自动恢复未完成任务、后台子代理 ownership 与 reporter  | ADR-0024，部分替代 [ADR-0009](../../docs/adr/0009-subagent-resume-outcomes.md)                                                                                                                                                                                                                                  | 去除不自动续跑约束，保留活动/结束原因/委派验收的区别   |
| 退出 close、取消 abort 与 Headless 请求结算           | ADR-0024，部分替代 [ADR-0010](../../docs/adr/0010-own-bash-tool-for-background-jobs.md) 的退出协调                                                                                                                                                                                                              | 宿主生命周期与任务终态分开；OS 进程仍清理且不恢复      |
| 能力 facts 改为 documents 与 durable 上下文           | ADR-0024，部分替代 [ADR-0016](../../docs/adr/0016-tool-state-and-context-projection.md)                                                                                                                                                                                                                         | 不再以旧状态消息和进程活动开关恢复                     |
| Checkpoint 与 Rewind                                  | ADR-0024，部分替代 [ADR-0017](../../docs/adr/0017-checkpoint-and-branch-rewind.md)                                                                                                                                                                                                                              | 保留备份责任，改用原生 fork/context/document 投影      |
| Goal continuation 持久化任务化                        | ADR-0024，部分替代 [ADR-0018](../../docs/adr/0018-goal-state-and-idle-scheduling.md)                                                                                                                                                                                                                            | 活跃工作可恢复，替代仅进程 armed 与旧 idle scheduler   |
| 恢复 Interaction 的当前规则与失效回复                 | ADR-0024，扩展 [ADR-0015](../../docs/adr/0015-frontend-interactions-and-plan-mode.md)                                                                                                                                                                                                                           | 交互结果仍经工具事实呈现，宿主请求可恢复且必须重新判定 |
| 工具与能力归属、Session 组装与目录依赖                | 沿用 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)                                                                                                                                                                                                                                                  | 能力集中维护，迁移不反转 Frontend 依赖方向             |
| 权限、auto-review 与 Trusted Project                  | 沿用 [ADR-0007](../../docs/adr/0007-auto-review-llm-only.md)、[ADR-0014](../../docs/adr/0014-permission-rules-and-project-trust.md)                                                                                                                                                                             | runtime 替换不改变显式规则与凭据来源                   |
| 自研 bash、OS Jobs、文件基线、图片与公网边界          | 沿用 ADR-0010、[ADR-0020](../../docs/adr/0020-file-tracking-baseline-transactions.md)、[ADR-0021](../../docs/adr/0021-native-image-input-persistence.md)、[ADR-0022](../../docs/adr/0022-public-web-fetch-network-boundary.md)                                                                                  | 自有能力边界继续生效，存储与执行适配按新基座更新       |
| MCP OAuth 与用户凭据                                  | 沿用 [ADR-0019](../../docs/adr/0019-mcp-oauth-credential-ownership.md)                                                                                                                                                                                                                                          | 升级 pi-mcp 不改变凭据所有权与服务器身份隔离           |
| Bun、测试运行时、Frontend/终端与 locale               | 沿用 [ADR-0001](../../docs/adr/0001-agent-runs-in-bun-sidecar.md)、[ADR-0004](../../docs/adr/0004-test-runner-per-runtime.md)、[ADR-0006](../../docs/adr/0006-fullscreen-tui.md)、[ADR-0008](../../docs/adr/0008-locale-agnostic-agent-core.md)、[ADR-0012](../../docs/adr/0012-single-coding-agent-package.md) | 生产运行时与呈现分层不因 harness 改变                  |
| 包版本、格式和消费者机械更新                          | 无需单独 ADR                                                                                                                                                                                                                                                                                                    | 实现已选定的 harness，不形成新的长期取舍               |

## Comments

2026-10-08：通过 implement-spec 开始实施，集成分支为 `codex/pi-durable-migration`，基线为 `41821852`。按 01–09 严格依赖推进；01 使用独立工作树验证精确发布依赖，门槛通过前不切换生产执行路径。测试入口沿用本规格已确认的公开 Harness、Session 与 Frontend seams。

2026-10-07：规格和九张实施票已发布到本地 Markdown tracker，全部为 ready-for-agent；仅设计交付，实施未开始。用户已确认公开 Session 与现有 Frontend 测试入口。设计覆盖审阅确认上述旧 ADR 冲突有明确替代归属；最终实现覆盖与验证由 09 完成，当前不能关闭 spec。

2026-10-07 文档交付验证：`rtk proxy bun run docs:update`、`rtk proxy bun run check:docs`（45 个维护 Markdown 文件）、`rtk proxy bun run check:scratch`、`rtk proxy bunx --no -- oxfmt --check`（限定本次 21 个 Markdown 文件）与 `git diff --check` 均退出码 0。另逐项校验本 effort 的 10 个 tracker 文件、48 个本地链接、九票顺序依赖和 46 条 User Stories，Implementation Decisions 无具体文件路径或代码片段。变更仅涉及设计文档与 tracker；未修改依赖/生产代码，未运行业务测试或目标运行时试验。

2026-10-07 代码更新后刷新：当前基线 92d17ca1（dsh ink merged-main 记录）；核对本地依赖、ADR-0013、renderer README、测试 helpers 与变更范围，补充新 Frontend seam、Sinon 时钟、真实 Hook readiness、ink AST 边界与依赖分类。Q1–Q9 和九票顺序依赖不变，全部仍 ready-for-agent；未开始生产迁移或重跑业务测试。

刷新验证：`rtk proxy bun run check:docs`（45 个维护 Markdown 文件）、`rtk proxy bun run check:scratch`、`rtk proxy bunx --no -- oxfmt --check .scratch/pi-durable-migration docs/adr/0024-adopt-pi-durable-harness.md`（11 个文件）和 `git diff --check` 均退出码 0；本 effort 的 52 个本地链接、九票顺序依赖及 46 条用户故事通过逐项检查。收尾核对 HEAD 仍为 92d17ca1。本次只刷新规格、六张相关票据与 ADR-0024，未运行业务测试。

2026-10-08 实施闭环：01–09依赖顺序交付、独立审查与集成完成；本spec与09在同一验收提交置resolved。当前46故事与13保留能力见 [coverage](coverage.md)，双轴review／三项finding及后续实际失败修正见 [review](review.md)。最终干净代码 `88f8b7667ef2e349f33815f98329cd0878f3f0a0` 的隔离HOME aggregate exit0：3061 PASS／0 FAIL／17634 assertions，280文件，测试102.23s／real105.52s，命令、完整日志、前三次FAILED、重跑依据和验证限制见 [09最终验收](issues/09-delivery-gate.md#comments)。gate后仅验收文档变更，不重跑全量；交付在codex/pi-durable-migration，不含main／PR，后续清理由协调者处理。
