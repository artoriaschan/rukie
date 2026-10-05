Status: resolved

# Spec: Subagent 的 Run Outcome 与 Session Resume

## Problem Statement

用户在子代理执行期间关闭 TUI，之后用原 Session id 恢复，能够看到历史子代理，却无法知道它们的最近一次 Run 是正常结束、中止、失败，还是因进程退出而中断。当前的 `idle` 只表示没有当前运行活动；把它解释为任务完成会掩盖未完成的委派，把历史活动恢复为 `running` 又会让用户误以为子代理仍在工作。

异常退出还可能留下有调用但没有结果的 Tool 记录。工具可能已经写入文件或产生外部副作用，仅凭结果缺失无法判断是否执行。恢复时隐式续跑或重放调用可能重复执行操作。用户需要保留对话、明确不确定性，并决定何时继续。

## Solution

将 Subagent Activity 与最近一次 Run Outcome 分开。正常关闭停止子 Run，等待收束和保存；Session Resume 恢复子 Session 身份与 Transcript，但不因恢复子代理而启动模型或子 Run。需要继续时，用户通过现有输入告诉父代理，由父代理向原子代理发送 `send_message`。

子 Transcript 的 Run 记录是结束事实的依据，父会话保存发现和显示所需的摘要。恢复父 Session 时，只读核对尚未结算的新 Run；旧记录或无法读取的记录保留未知。有开始事实、核对后没有结束事实、也没有对应运行实例的新 Run 归为中断。

TUI 每次恢复给出一次说明，自动子代理列表继续依据实际运行活动显示。用户第一次真实输入时，父模型收到一次恢复摘要；摘要自身不唤醒模型。存在 Tool 调用但缺少结果时，在实际恢复对应 Session、继续执行前追加持久化的“结果未知”恢复信息，保留原始调用，不自动重放。

## User Stories

1. As a TUI 用户, I want 使用原 Session id 恢复父会话, so that 我能继续原来的对话和委派关系。
2. As a TUI 用户, I want 恢复保留子 Session 身份和已有 Transcript, so that 已完成的探索与文件工作不会因退出而丢失。
3. As a TUI 用户, I want 恢复本身不启动子 Run, so that 我能先检查状态再决定继续。
4. As a TUI 用户, I want 恢复提示本身不请求模型, so that 打开历史不会隐式执行新工作。
5. As a TUI 用户, I want 正常关闭停止仍在执行的子 Run, so that 关闭完成后不会继续产生新的子代理操作。
6. As a TUI 用户, I want 正常关闭等待子 Run 收束与 Transcript 保存, so that 下次恢复能看到可靠的结束记录。
7. As a TUI 用户, I want 区分当前运行活动和历史结束原因, so that 我不会把当前空闲误认为任务完成。
8. As a 父代理, I want `completed` 只说明最近一次 Run 正常结束, so that 我仍能根据结果判断委派任务是否完成。
9. As a 父代理, I want 每次续跑有独立的 Run 身份与结束事实, so that 之前的成功不会覆盖这次中断。
10. As a 父代理, I want 子 Transcript 中已经保存的结束事实优先于父摘要, so that 父摘要滞后不会造成误判。
11. As a TUI 用户, I want 旧会话没有 Run 记录时显示结束原因未知, so that 系统不会捏造完成或中断。
12. As a TUI 用户, I want 有开始但没有结束事实的新 Run 被识别为中断, so that 我能发现退出时未收束的工作。
13. As a TUI 用户, I want 缺失或损坏的子记录显示无法确认, so that 不确定性不会被伪装成中断或完成。
14. As a TUI 用户, I want 单个子记录无法读取时仍能恢复父 Session, so that 历史委派异常不会阻止整个对话继续。
15. As a TUI 用户, I want 恢复时只核对尚未结算的新 Run, so that 大量已结束的历史子会话不会触发全量加载。
16. As a TUI 用户, I want 已结算的子 Run 使用已保存的父摘要, so that 历史列表可以直接呈现已有事实。
17. As a TUI 用户, I want 恢复提示说明中止、中断、失败或未知的子 Run, so that 我知道哪些委派需要检查。
18. As a TUI 用户, I want 正常结束的子 Run 不作为恢复警告, so that 提示聚焦于需要关注的情况。
19. As a TUI 用户, I want 每次恢复只出现一次新恢复提示, so that 渲染和状态更新不会重复刷屏。
20. As a 父代理, I want 在恢复后的第一次真实用户输入时收到恢复摘要, so that 我能结合用户意图决定下一步。
21. As a 父代理, I want 恢复摘要不在之后每次输入时重新注入, so that 已保留的上下文不会反复膨胀。
22. As a TUI 用户, I want 在再次关闭并恢复后重新得到本次恢复摘要, so that 每次打开都能获知当前恢复结果。
23. As a TUI 用户, I want 自动子代理列表只在存在实际运行活动时展示, so that 历史子代理不会永久占用对话区域。
24. As a TUI 用户, I want 手动子代理历史视图仍保留原有身份与结束信息, so that 自动列表隐藏后我仍能检查历史。
25. As a TUI 用户, I want 通过现有输入让父代理继续原子代理, so that 不需要学习新的按钮或快捷键。
26. As a 父代理, I want `send_message` 对空闲子代理恢复原子 Session 并开始新 Run, so that 续跑可以利用原有上下文。
27. As a 父代理, I want `send_message` 对正在运行的子代理保留现有 steer 行为, so that 本功能不会改变实时协作。
28. As a TUI 用户, I want 有调用但缺少结果的 Tool 被标记为结果未知, so that 我不会把没有保存结果误认为操作未执行。
29. As a 父代理, I want 结果未知的恢复信息进入模型上下文, so that 我能先检查实际状态再决定是否重试。
30. As a TUI 用户, I want 恢复不自动重放缺失结果的调用, so that 已产生的文件或外部副作用不会被重复执行。
31. As a TUI 用户, I want 恢复信息追加到 Transcript 并保留原始调用, so that 我能追溯当时的请求与不确定结果。
32. As a TUI 用户, I want 对同一调用的重复恢复不重复追加修复信息, so that Transcript 保持稳定。
33. As a TUI 用户, I want 已经保存的真实 Tool 结果保持原样, so that 成功、失败与原有输出不会被恢复逻辑覆盖。
34. As a TUI 用户, I want 仅恢复父会话时不修复或运行历史子会话, so that 只读检查不会变成子会话执行。
35. As a 父代理, I want 实际恢复子 Session 时先处理缺失结果再请求模型, so that 新 Run 看到一致且诚实的上下文。
36. As a TUI 用户, I want 恢复提示和摘要不创建 Checkpoint, so that 文件回退仍以真实用户 prompt 为锚点。
37. As a TUI 用户, I want 续跑子代理的文件写入继续归父 Session 当前 Checkpoint, so that 我能统一回退父子工作。
38. As a TUI 用户, I want 恢复信息在中英文及窄终端下仍可读, so that 提示不会遮挡输入或破坏现有布局。
39. As a Headless CLI 使用者, I want Agent Core 的恢复事实与 TUI 使用同一语义, so that 结束判断不会因 Frontend 不同而改变。
40. As a 维护者, I want 从事件回调内调用 `dispose` 仍不会等待自己的 Run, so that 新增关闭收束不会引入死锁。

## Implementation Decisions

### 领域与持久化边界

- 沿用 Session、Run、Subagent、Transcript、Tool State、Session Store 与 System Reminder。复用 pi Agent loop 和现有原生 JSONL 格式，不引入另一套 Activation、Inbox 或调度系统。
- 修改 Agent Core 的 Session 生命周期、Subagent 身份与摘要、Tool State 恢复、Transcript 上下文恢复，以及 TUI 的恢复提示与子代理状态接线。Frontend 组件继续通过 props 接收呈现数据。
- 每次子 Run 的持久化事实至少能关联所属子 Session、稳定的 Run 身份、开始事实以及可用的结束原因。子 Run 开始执行前保存开始事实；结束事实先保存在子 Transcript，再更新父摘要。
- 父 Tool State 保留子身份、最新 Run 关联和来自子事实的摘要。父摘要是发现与呈现的缓存，不是替代子 Transcript 的结束事实。历史事实不能直接重建当前进程的运行活动。
- 最近一次 Run 覆盖最近一次呈现的结束原因，但不改写前一次 Run 的原始记录。新的续跑不能借用上一 Run 的完成原因。
- 新数据带版本并能解析旧子代理身份记录。旧记录缺少可关联的 Run 事实时，其结束原因是未知；不能从 `idle`、最后一段 assistant 文本或父会话的回答推断完成。
- 只处理当前 Transcript 分支上的事实；Rewind 不应让被移出当前分支的父摘要或恢复摘要重新生效。持久化记录明确所属 Session 与 Run，不能将 fork 继承的上下文当成本次子 Run 的新事实。

### 运行活动、结束原因与关闭

- Subagent Activity 仅反映实际运行实例。模型侧 `list_agents` 保留既有运行状态语义；如呈现 Run Outcome，则作为独立信息，不将历史 outcome 塞进当前运行状态。
- Run Outcome 区分正常结束、明确中止、错误结束、恢复推导的中断以及未知；保留实际结束原因所表达的不完整或异常信息。`completed` 不构成业务任务已验收的判断。
- 正常 Frontend 关闭发起取消，等待它拥有的父子 Run 收束、结束事实保存与 Session Store 关闭后才报告关闭完成。关闭通知或恢复信息不能在此期间触发新的模型请求。
- 保留 `Session.dispose` 的可重入语义：事件观察者能够等待它而不等待所属 Run。外部关闭完成边界等待已启动的 Run promise 等公共完成信号；不通过内部回调自等待达成收束。
- 存储错误不得被伪装为正常完成。异常退出只承诺恢复已经保存的事实，不承诺恢复内存中的执行栈或撤销已经产生的副作用。

### Session Resume 与摘要

- 恢复父 Session 时，依靠父摘要确定需核对的尚未结算的新 Run，只读观察相应子 Transcript；不物化子 Agent，不扫描全部历史子 Session，也不修复子记录。
- 若核对得到该 Run 的结束事实，即使父摘要滞后也按子事实呈现；若有开始、没有结束且没有对应运行实例，则呈现中断；若读取失败或无法可靠关联，则呈现未知与无法确认的诊断，恢复父 Session 继续进行。
- 已结算 Run 使用已保存的父摘要，旧记录保持未知。父子 Session 的已有所属关系和访问边界继续生效。
- Agent Core 提供 Frontend 和模型共用的结构化恢复结果，包括子身份、最新 Run 的已知结束原因与无法确认的诊断。优先沿用现有 Session 公开状态和事件边界；若必须扩展查询，只在 Session 公共层提供最小只读能力。
- TUI 每次恢复呈现一次提示，仅提醒明确中止、中断、错误或未知的子 Run。正常结束不产生恢复警告；组件重渲染不会重复发布提示。
- 恢复摘要等待第一次真实用户输入，作为 System Reminder 等既有内部上下文进入父 Transcript 与模型请求。提示、内部通知、Hook 内部续跑等不是这次真实输入的替代品，也不应提前消费待投递摘要。
- 同一次恢复后只追加一次摘要；后续自然通过 Transcript 保留，不在每次输入时重新注入。关闭后再恢复会生成新的一次恢复摘要。空摘要不产生无内容的提醒。
- 自动子代理列表继续使用实际活动判断：没有运行中的子 Run 就隐藏；有子 Run 正在运行时保留现有列表呈现与结束上下文。手动历史视图继续可用。本轮不新增直接续跑入口。
- `send_message` 继续遵循已有行为：活跃子 Run 接收 steer；空闲子代理复用原 Session 身份和历史开始新 Run。恢复事实本身不驱动续跑。

### Unknown Tool Outcome

- 在实际打开对应 Session 的恢复边界，查找当前分支中有已保存调用、却没有匹配真实结果的 Tool。已有真实结果保持原样。
- 追加可关联原调用身份的持久化恢复信息，明确表示结果未知，不能将它解释为实际失败、成功或尚未执行。模型上下文必须得到能够处理该孤立调用的协议兼容结果表示；其中恢复占位与真实 Tool 结果可区分。
- 不依赖 provider 临时补出的缺失结果文字作为持久化事实，不修改已有调用。重复打开不会为同一孤立调用重复追加恢复信息。
- 缺少独立开始证据时，不推断调用是否执行；新 Run 在请求模型前看到这一不确定性与先检查实际状态再决定重试的指导。恢复流程自身不执行该 Tool。
- 打开父 Session 只修复父 Session 的缺失结果。历史子 Session 的修复在之后实际恢复该子 Session、开始新的 Run 前执行。

### Frontend 与既有能力

- Agent Core 继续 locale-agnostic；TUI 解析 locale 并呈现中英文提示。内部模型上下文不受界面语言改变事实含义。
- 恢复提示、只读核对、修复记录和内部摘要不新建 Checkpoint。之后的真实父 user prompt 按既有规则创建 Checkpoint，子代理写入仍归父当前 Checkpoint。
- 本功能不得因恢复元数据启动新 Run；已有独立授权的 Hook 或 Goal 调度语义不在本轮改造范围。摘要消费仍以真实用户输入为边界。

## Testing Decisions

### 公共测试边界

- 用户已确认复用两个现有公共入口。Agent Core 主入口是 `createSession` 与 Session 的公开调用、状态和事件，使用可控模型、临时目录及真实 Session Store；TUI 主入口是实际启动入口与虚拟终端，通过 `--resume`、输入、退出和可见输出验证。
- 好的测试断言用户或父模型可观察到的行为：模型请求是否发生、请求收到哪些事实、原子代理 id 是否复用、关闭是否完成、重新打开后的状态、持久化 Transcript 内容、文件副作用次数、提示次数以及终端布局。
- 不直接断言内部 Map、reducer、私有 helper、序列化调用顺序或组件内部状态。所有恢复关键用例创建新的 Session 实例，必要时启动新的 Frontend 或子进程，不能用保留的内存对象代替恢复。
- 参考已有 Subagent E2E、Session dispose E2E、Checkpoint 子代理 E2E，以及 TUI resume、subagent panel、subagent views E2E。沿用可控模型和虚拟终端测试设施，不新增一套专用恢复测试入口。
- 使用模型调用门闩、公开事件、Run 完成 promise 或终端可观察条件同步，不通过任意 sleep 推断完成。崩溃用真实中断进程或符合现有格式的截断事实夹具；不得把正常 dispose 当成崩溃。

### 必须覆盖的场景

| 场景                                       | 外部可观察的验收结果                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| 子 Run 正常结束后关闭并恢复                | 身份与历史保留，无自动模型请求、无运行中的自动列表、无恢复警告               |
| 子 Run 执行期间正常退出                    | 关闭等到已启动的 Run 收束；重新打开能看到明确中止或实际结束事实，无续跑      |
| 事件回调内等待 dispose                     | 不形成自等待；外部仍可等待 Run 完成并重新打开保存的 Transcript               |
| 新 Run 有开始事实，进程在结束前退出        | 恢复只读核对后呈现中断，不伪装完成或恢复成运行中                             |
| 子结束已保存、父摘要尚未更新               | 恢复按子结束事实呈现；不将其误判为中断                                       |
| 子代理先完成一次、下一次 Run 中断          | 最新呈现属于第二次 Run，不沿用第一次完成事实                                 |
| 旧子代理身份记录                           | 保留身份、呈现结束原因未知，不推断历史任务完成                               |
| 待核对的子记录缺失、损坏或无法读取         | 该项未知并给出无法确认诊断，其余恢复和父会话继续可用                         |
| 大量已结算历史与少量未结算 Run             | 仅观察需核对的新 Run；不打开所有历史子 Session、不请求子模型                 |
| 恢复后未输入、内部事件或重渲染发生         | 无恢复引发的新 Run，提示不重复，摘要不提前消费                               |
| 恢复后第一次和第二次真实输入               | 第一条模型请求包含本次恢复摘要，第二条不新追加同一摘要                       |
| 投递后关闭并再次恢复                       | 新一次恢复提示与摘要按本次结果生成，各投递一次                               |
| 已结束、错误、中止、未知子代理混合         | 非正常或未知者得到准确提醒，正常结束者不作为警告                             |
| 原子代理经 send_message 续跑               | 复用 id 与历史，打开后先修复缺失结果，再开始新 Run；活跃 steer 行为仍成立    |
| Tool 调用存在但结果缺失                    | 持久化结果未知，与原调用关联；模型看到不确定性，工具副作用计数不会因恢复增加 |
| 已有真实 Tool 结果及混合调用批次           | 真实结果不改写，仅缺失项修复；重复恢复没有重复占位结果                       |
| 仅恢复父会话，子有孤立 Tool 调用           | 子 Transcript 内容不变；实际续跑子 Session 时才修复                          |
| Compaction 或 Rewind 后再恢复              | 使用当前分支可达的状态和恢复信息，不重引入被回退分支事实                     |
| 恢复提示、修复信息、第一次用户输入与子写入 | 前三者中只有真实输入创建 prompt Checkpoint，子文件写入仍归父当前 Checkpoint  |
| TUI 中英文、40×12 与常用终端尺寸           | 提示可读、输入可用；自动列表隐藏与出现不破坏既有高度预算或手动历史视图       |

- Bun 运行时代码沿用 `bun:test`。实施时运行相关 Core 与 TUI E2E，再运行仓库要求的完整检查；本规范阶段不运行实现测试或声称上述行为已经通过。

## Out of Scope

- 自动重启、自动续跑或重放子代理、Tool 调用、未保存的 prompt、内存执行栈。
- 将 `completed` 定义为整个委派任务验收完成，或新增业务任务状态机。
- 复制 deepseek-harness 全部 Activation、Inbox、递归子代理、守护进程或跨进程工作管理机制。
- 全量扫描或修复历史子会话，恢复父会话时加载子 Agent，以及后台持续巡检历史。
- 新增直接续跑按钮、快捷键、额外的恢复面板，或重做现有子代理 Dashboard 和 Rewind UI。
- 改变已有子代理类型、模型路由、Permission Mode、Plan Mode、Hook 或 Goal 的独立策略。
- 自动撤销未知调用的副作用、推断外部操作成败，或扩展 Checkpoint 对 bash、MCP 的文件覆盖范围。
- 替换 Session Store、改变原生 JSONL 格式、实现桌面端，或为本功能新增通用消息队列。

## Further Notes

- 设计来自本次对 deepseek-harness 的只读调查及 Q1–Q8，已记录在 [ADR-0009](../../docs/adr/0009-subagent-resume-outcomes.md)，术语沿用 [CONTEXT](../../CONTEXT.md)。采用恢复语义，不迁移整个运行架构。
- 用户已确认 Q1–Q8 的设计及 Core、TUI 两个公共测试边界。实施工单 01–04 已完成，状态均为 `resolved`。
- 实现由子代理使用 implement / tdd 在独立受管 worktree 完成，经集成检查与独立 Standards / Spec 复审验收。交付采用合并 main 后清理开发工作树的方式；最终代码验证与复审证据见 [verification.md](verification.md)。
