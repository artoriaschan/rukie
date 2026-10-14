# Rukie

Rukie 是 coding agent。Agent Core 组合原生 durable 执行、工具、MCP、skills 和上下文注入；Headless CLI、TUI 和桌面端本机 server 都是驱动它的 frontend。

## Language

### 运行

**Agent Core**:
与界面无关的 agent 运行时。各个 frontend 通过它来运行 session。
_Avoid_: engine, backend

**Frontend**:
驱动 Agent Core 并把 run 呈现给用户的程序：Headless CLI、TUI，以及为桌面界面提供网络接口的本机 server。
_Avoid_: client, UI

**Headless CLI**:
`rukie -p` 或 `rukie --goal` 启动的非交互 frontend：读入一条 prompt 或设定 Goal，等待该请求引发的 Run、后台子代理及报告处理结算，输出文本或 stream-json 后退出。不提供任何 Interaction 回调：依赖交互的工具不暴露给模型，Agent Core 自身发起的交互取各自的安全默认值。
_Avoid_: CLI（会和 TUI 混淆）

**TUI**:
不带 `-p` 或 `--goal` 启动 `rukie` 时运行在终端里的交互式 frontend，在同一个 session 里连续接收 prompt；命令行位置参数作为首条 prompt。
_Avoid_: CLI, REPL

**Session**:
用户与 agent 的一段连续对话，可以凭 id 恢复。Session 只有一个当前工作目录，SQLite Session 可经 Session Move 改绑，身份与 Transcript 保持不变。桌面端 Session 持久绑定 Project；主目录变化在下一次空闲打开执行前同步，只读订阅历史不移动，活跃 Run 不被中断。Frontend 可在打开时提供附加目录；这些目录只贡献环境快照中的路径与各自 `AGENTS.md` 的 Project Instructions，不改变工具执行目录、权限路径解析或文件跟踪，也不合并 settings、hooks、MCP 与技能。
_Avoid_: conversation, thread, chat

**Session Move**:
在写者租约内将 SQLite Session 的 cwd 改绑到新目录的组织操作。Transcript 追加旧、新 cwd 记录，并原子更新 Session 元数据；不创建 Session、不调度 Resume、不解析模型或凭据，不复制或删除工作目录文件。下一次 Run 从最近尚未告知的移动记录追加 system reminder 与新目录环境快照，恢复后不重复告知。最近移动之前的 Checkpoint 只允许对话 Rewind，不能恢复代码；见 [ADR-0040](docs/adr/0040-session-move-transcript-boundary.md)。
_Avoid_: copy session, workspace migration

**Transcript**:
一个 Session 的有序追加事实，包括原始消息、工具结果、提醒与上下文边界。Tool State 由独立的 typed documents 持久化。Compaction 和上下文 reset 改变后续模型可见的投影，不删除原始事实；Rewind 保留原对话。`Session.messages` 呈现当前选中对话的完整消息序列，包括已压缩的旧消息，不等同于当前模型上下文，也不包含所有被回退的对话。
_Avoid_: history, log

**Turn**:
一次模型调用，加上这次调用返回的工具调用。
_Avoid_: step, round

**Run**:
原生 Conversation 从接受输入到停止的一段执行，可在执行边界纳入后续输入。输入来自用户、父代理、Hook、Goal 或通知。一个 Run 包含一个或多个 Turn；父 Run 可以先于后台 Subagent 结束；一次请求的因果结算另行等待其子 Run、reporter 与结果引发的处理，不包括无关后台工作。
_Avoid_: task, job（job 专指 Background Job）

**Request**:
一次进入 Session 的外部输入及其因果引发的全部工作。来源包括用户 prompt、Goal 激活与续跑轮次、子代理报告、发往子代理的消息和 Hook。Request 的结算等待它引发的 Run、后台子 Run、reporter 与结果处理，不包括无关后台工作；一个 Request 可以跨多个 Run。
_Avoid_: interaction, submission, prompt

**Queued Input**:
Run 进行中用户发送、等当前 Run 停止调用工具后才放入对话的输入。随 Session 持久化，按发送顺序每次放入一条；放入前可撤回或改为立即放入（steer）。中止 Run 时全部撤回并交还给 frontend。
_Avoid_: follow-up, pending message, draft

**Subagent**:
由父 session 的模型经 `subagent` / `subagent_fork` 创建的子 session，可在父 session 内经 `send_message` 续跑。每个 run 默认在后台进行，父代理继续工作；结束时其最终文本作为一条消息交回父代理。`subagent` 从空历史开始，`subagent_fork` 带着父代理已完成的 turn 开始。判定配置与父 session 共享，只能收窄；不能再创建 subagent。
_Avoid_: task, worker, child agent, job（job 专指 Background Job）

**Subagent Activity**:
子代理当前是否正在处理 Run。没有运行中的 Run 只表示当前不在工作，不能据此判断委派任务已经完成。
_Avoid_: task completion, Run Outcome

**Run Outcome**:
某次 Run 的结束原因。正常结束只表示这次 Run 停下，整个委派任务是否完成仍由父代理判断；没有足够的历史记录时，结束原因是未知的。
_Avoid_: task completion, Subagent Activity

**Session Resume**:
使用原 Session 的身份和 Transcript 恢复对话。打开时按原生任务继续已接受且未结算的工作，包括后台子 Run 和 reporter；已结束或取消的历史事实不会自行创建新工作。列表和只读查询不启动恢复。
_Avoid_: restart task, automatic continuation

**Background Job**:
由 `bash` 启动、在这次工具调用返回后仍继续运行的进程：模型显式要求后台运行，或前台命令超时后转入后台。归启动它的 session 所有，结束时通知该 session 的模型；顶层 run 结束不影响它，session 结束时被终止。子 session 的 Background Job 在子 run 结束时被清理，不通知或唤醒子模型。不持久化，Session Resume 后不存在。Subagent 不是 Background Job。
_Avoid_: task, background shell, background command

**Unknown Tool Outcome**:
Transcript 中存在 Tool 调用，但没有可确认的结果。不能据此判定调用成功、失败或尚未执行，也不能据此认定没有产生副作用。
_Avoid_: tool failure, unexecuted tool

**Tool State**:
由所属能力维护、经原生 typed documents 持久化的事实，如 Todo List、Goal 和文件基线。能力声明版本、校验、历史与 fork 策略；恢复读取已提交值，坏状态或不支持的版本阻止打开。清空与初始值由能力定义。运行活动由原生 tasks 及其 ownership 保存，与这些事实分开。
_Avoid_: tool data, session state

**Tool View**:
一次工具调用或其结果的呈现意图，由工具自己声明，由 frontend 渲染。只包含事实（命令、路径、diff、退出码）与工具显示名的字典键，不含任何自然语言文案。不持久化：随事件下发，resume 时由 Transcript 重算。
_Avoid_: tool card, tool presentation

**Todo List**:
模型为当前 session 维护的任务清单，是一种 Tool State。每项只有内容和状态（待办 / 进行中 / 已完成），每次整表替换。属于单个 session：子代理有自己的 Todo List，不与父 session 共享。与 Goal 相互独立。
_Avoid_: task list, plan

**Checkpoint**:
某条真实 user prompt 之前、文件工具 `write` / `edit` 首次写入每个文件前的原样内容。每条真实 user prompt 一个；内部续跑与通知不另建。以 prompt 的 transcript entry id 为锚点，文件路径经权限相同的 realpath 规范化，引用作为 Tool State `checkpoint` 持久化。Headless CLI 和 TUI 的备份存放在 `homeDir/.rukie/file-history/<sessionId>/`；桌面端备份存放在独立数据根下的 `file-history/<sessionId>/`，document 保存相对引用，清理保留仍被历史分支引用的文件。bash 与 MCP 工具造成的改动不在其中。子代理与父 Session 共用记录器，备份引用归父级当前 Checkpoint document；工具消息留在实际执行的子对话中。子 Session 不建自己的 Checkpoint。
_Avoid_: snapshot, backup, undo point

**Rewind**:
回到某个 Checkpoint 的动作，可选只回代码、只回对话或两者都回。回对话在那条真实 prompt 之前创建原生 fork，按能力的历史策略恢复 documents，保留原对话与消息；不复制后来的任务活动。回代码还原 Checkpoint 文件内容，可能覆盖后续改动。最近 Session Move 之前的 Checkpoint 不能恢复代码，对话恢复仍可用。父子均无活跃工作时才可用；两者同时恢复先执行文件恢复，失败不切换对话，已发生的文件写入不保证整体回滚。
_Avoid_: undo, revert, rollback

**Session Store**:
Transcript、documents、任务与父子 ownership 的持久化位置。Headless CLI 和 TUI 默认使用启用 fsync 的原生 JSONL 目录；桌面端本机 server 使用独立应用数据根下每个根 Session 的原生 SQLite Storage，同一根 Session 的子代理共用该存储。宿主保证单个写者，关闭或进程退出释放租约。桌面端与终端的 Session、配置及凭据隔离，不自动导入或回退到旧数据。列表与只读查询只观察已提交状态，不取得执行租约、不启动模型或调度恢复。桌面端的项目、Session 索引、置顶与偏好由独立应用数据库保存，不属于 Session 的执行事实；见 [ADR-0035](docs/adr/0035-desktop-isolated-sqlite-storage.md)。
_Avoid_: database, history store

**Project**:
用户在桌面端登记的有序非空目录集合，具有可编辑的名称、一个主目录与显式信任状态。新 Session 使用当前主目录；server 在应用数据根中持久保存 Session 绑定，wire 摘要 `projectId` 读取该绑定，Frontend 不按 cwd 推测归属。编辑目录或切换主目录保持绑定；主目录在后续空闲打开执行前经 Session Move 同步。没有绑定的 Session 列在“对话”分类下，每个新对话独占应用数据根的 `workspace/<id>/`，删除对话时一并删除该目录；既有 cwd 为 `workspace/` 根的 Session 不迁移，删除时保留根目录；该分类只是导航呈现，不是领域概念。Project 的真实目录不重叠且不包含应用数据根或其子目录。创建或补确认授予全部目录的精确信任；已信任 Project 新增目录必须再次确认，未信任 Project 编辑后保持未信任。切换主目录不改变名称或重询信任。移除 Project 先删除全部绑定 Session（含置顶与归档），全部成功后移除登记，目录文件保留；任一绑定 Session 忙碌时整体拒绝，中途删除失败保留 Project 供重试。既有 Session 不补写绑定。
_Avoid_: workspace, folder

**Archived Session**:
从桌面端导航与搜索中隐藏、但 Transcript 与 Session Store 保持不变的 Session。归档属于桌面端的组织信息，不是 Session 的执行事实；Archived Session 不能同时被置顶。
_Avoid_: deleted session, hidden session

**Locale**:
frontend 呈现文案所用的语言，由 frontend 自行解析。Agent Core 不感知 locale：它产出的内容和 transcript 与 locale 无关，同一个 session 可以在不同 locale 的 frontend 中恢复。
_Avoid_: language（会和模型回复语言混淆）, i18n

**Slash Command**:
用户在 frontend 输入的 `/` 开头的指令，由 frontend 解析并调用 Agent Core 的能力；Agent Core 不感知命令语法。只有内置命令，没有自定义命令：用户要复用的 prompt 写成 skill，经 Skill Invocation 调用。frontend 匹配不上的 `/` 输入原样交给 Agent Core。
_Avoid_: command（会和 bash 命令混淆）

**Goal**:
用户为 Session 设定的目标事实。真实用户接受的自动续跑由原生 task 保存并驱动，实际放置的 Goal 输入消费轮次；close/reopen 继续已接受工作，历史事实本身不提供执行授权。模型判定完成或受阻、用户暂停、取消或达到上限后停止，重新开启需真实用户授权。
_Avoid_: task, objective

**Side Question**:
基于 session 当前上下文的一次单轮简短回答。主 run 独立继续，侧问不带工具，问题与回答都不进入 transcript。
_Avoid_: steer, follow-up turn

**Model Selection**:
Session 当前使用的模型（`provider/id`）与 Thinking Level，是 Session 状态的一部分。新 Session 取 settings 默认值；用户在 Session 空闲时切换后只对该 Session 生效，随 Rewind 回到当时的选择，resume 时恢复，不改写 settings。继承模型的 Subagent 取父 Session 当时的模型与 Thinking Level；显式指定模型的 Subagent 取 settings 默认 Thinking Level。
_Avoid_: model route, active model, model switch（指动作时说"切换 Model Selection"）

**Thinking Level**:
请求模型时要求的推理强度档位，从 `off` 到 `max`。模型不支持 reasoning 时明确强度档位不可用；模型不支持所选档位时降到它支持的下一个较低档，没有更低档时取它支持的最低档，从不升档。`automatic` 是不指定推理等级、开关或预算的选择，由供应商决定，不参与强度降档，也不等同明确关闭；它作为 Model Selection 保存、恢复和回退。
_Avoid_: reasoning effort, effort, thinking budget

**Model Service**:
用户在桌面端配置的一个模型端点：名称、协议、Base URL、凭据和它提供的模型。Model Selection 中的 `provider` 指它；它只属于用户，项目不能定义。可整体停用，停用后它的模型不可选择，各模型自身的启用状态保持不变。
_Avoid_: provider config, endpoint

**Provider Preset**:
Rukie 内置的一份供应商接入资料，作为创建 Model Service 的起点。创建出的 Model Service 归用户所有，之后与预设没有执行关联；预设随版本更新不会改变已创建的服务。
_Avoid_: template, catalog

### 给模型的上下文

**System Prompt**:
固定的指令，规定 agent 的身份和行为方式。所有项目都用同一份。
_Avoid_: preamble

**System Reminder**:
harness 注入给模型、用户看不到的上下文，用 `<system-reminder>` 包裹，附在 user 消息或 tool result 上。注入之后就成为 transcript 的一部分。
_Avoid_: hint, injected context, attachment

**Project Instructions**:
用户为项目写的说明（`AGENTS.md`，没有时用 `CLAUDE.md`），以 system reminder 的形式交给模型。
_Avoid_: memory, rules file

**Session Title**:
session 的显示名，用于恢复时挑选。先取首条 user prompt，再由模型总结一次；用户改名后固定，不再自动覆盖。子代理的 session 用委派描述作标题。
_Avoid_: session name, label

**Compaction**:
上下文接近模型上下文窗口时自动触发，或由用户手动发起的上下文压缩，把较早的消息摘要成可继续对话的上下文。之后的 turn 和 resume 都从摘要加上它之后的消息继续，原始消息仍保留在 transcript 里。
_Avoid_: summarization, context pruning

**Context Usage**:
当前 transcript 发给模型时占用的 token 数，相对于模型的上下文窗口。总量以 provider 报告为准；按 system / prompt / assistant / thinking / tools 分段只是估算，用来表示占比。
_Avoid_: context size, token count

**Context Report**:
供 frontend 呈现的当前模型上下文占用快照，按类别和来源给出估算，并结合可用的实际使用总量。报告不进入 transcript，也不成为模型上下文的一部分。
_Avoid_: usage event, transcript statistics

### 能力

**Tool**:
模型可以调用的动作。来源有三种：内置、来自 MCP server，或者是用来加载 skill 的那个工具。
_Avoid_: function, command

**Skill**:
由 `SKILL.md` 定义的一个指令目录，遵循 Agent Skills 规范。模型目录只展示模型可调用技能的 name 和规范化 description，正文通过 skill 工具或用户的 Skill Invocation 按需提供。目录以当前模型可见上下文为准，内容变化时完整替换，不重复追加未变条目。
_Avoid_: plugin, recipe

**MCP Server**:
通过 Model Context Protocol 提供工具的外部进程或 endpoint。它的工具命名为 `mcp__<server>__<tool>`。远程 server 可能要求 OAuth 授权：未授权时它的真实工具不可用，只暴露一个 `authenticate` 工具供模型发起授权。
_Avoid_: connector, integration

**Deferred Tool**:
尚未向模型提供定义、需要先经 Tool Search 找到才能调用的工具。只有 MCP 工具（不含 authenticate）会成为 Deferred Tool，内置工具不延迟。一旦被找到，只要工具仍存在，它在该对话后续轮次中保持可调用；当前可见集由该分支的 Transcript 推导，子 Session 独立维护。
_Avoid_: lazy tool, hidden tool

**Tool Search**:
模型按查询检索 MCP 工具并加载匹配的 Deferred Tool 定义的动作。设置可强制开启、关闭或按候选定义的上下文占比自动判定，不要求模型支持原生对话中工具追加。适配器根据模型能力将已加载定义放入下一次请求的工具列表或原生追加格式。已可见的工具不因判定变化而收回，搜索不替代执行工具时的 Permission Decision。
_Avoid_: tool discovery, tool lookup

**MCP Credential**:
用户为某个 MCP Server 完成 OAuth 授权后得到的凭据。属于用户，所有 session 与项目共用；按 server 名、url 与 headers 识别，同名但指向别处的 server 拿不到它，项目配置因此不能借用户身份连到别的地址。
_Avoid_: token, auth, session

**Trusted Project**:
用户明确表示信任的项目目录。只有 trusted project，其项目级 `.mcp.json`、项目级 allow 规则与项目级 hook 才会被加载。项目级配置任何情况下都不能定义 provider。
_Avoid_: safe project, whitelisted repo

**Skill Invocation**:
用户在 prompt 开头写 `/name`，主动展开一个 skill。展开的正文以 system reminder 形式附在消息上。
_Avoid_: slash command, macro

**Hook**:
用户配置、在 Agent Core 生命周期事件（工具调用前后、权限询问与拒绝、用户提交 prompt、session 开始结束、run 结束、子代理开始结束、compaction 前后、交互开始）上执行的外部程序，协议对齐 Claude Code。可阻断、改写工具参数、向模型注入上下文、让即将结束的 run 继续；改写后的参数仍要经过权限规则，hook 的 allow 越不过规则的 deny。
_Avoid_: callback, plugin, middleware

**Permission Decision**:
对单次工具调用在执行前做出的判定：`allow`、`deny` 或 `ask`。`ask` 交给 frontend 询问用户；Headless CLI 没法询问，按 `deny` 处理。由固定顺序的阶段得出：hooks → 权限规则 → Permission Mode → 询问用户；多个阶段有意见时取最严（deny > ask > allow），hook 的 allow 越不过规则的 deny。内置工具、MCP 工具与 skill 工具一律适用。
_Avoid_: approval, consent

**Interaction**:
Agent Core 在 run 中向 frontend 发起、并挂起等待用户回复的一次请求，如审批 permission decision 的 `ask`、模型向用户提问、plan 评审、MCP OAuth 授权。每种交互一个 frontend 回调；frontend 不提供回调时，依赖它的工具不暴露给模型，Agent Core 自身发起的交互取安全默认值。用户拒绝单次交互不影响 run；run 中止时挂起的交互以取消结束。交互本身不进 transcript，其结果体现在工具结果里。
_Avoid_: prompt（会和用户 prompt 混淆）, dialog, request

**Plan Mode**:
session 级开关，与 Permission Mode 相互独立。打开时模型先探索、再把 markdown 计划交给用户评审，用户批准后才退出。它只引导模型，不限制工具：工具调用照常按 Permission Rule 与 Permission Mode 判定。由用户或模型（需用户批准）打开，随 transcript 持久化，resume 后保留。subagent 与父 session 共用同一个 Plan Mode 状态。
_Avoid_: plan permission mode, read-only mode

**Permission Rule**:
用户写下的一条 `allow`、`ask` 或 `deny`，按工具名、bash 命令文本、文件路径或网页域名匹配工具调用。命中的 `deny` / `ask` 在任何 Permission Mode 下都生效，`ask` 规则也不交给 permission review。用户层与项目层合并；项目层的 `allow` 只在 trusted project 生效。审批时"本 session 允许"生成的是只在当前 session 内存中的 allow 规则。规则不是安全边界。
_Avoid_: policy, whitelist, allowTools

**Permission Mode**:
决定 permission decision 如何得出的 session 级开关，三选一：`ask`（文件工具在 Session 访问范围内 allow，范围外 ask；其他工具沿用各自默认值）、`auto-review`（文件工具在范围内 allow，其余需授权调用由 permission review 判定，安全的 allow，有风险的 ask）、`full-access`（模式本身不再询问：本该由模式 ask 的都 allow，但用户显式写下的 deny / ask 规则与 hooks 照常生效）。默认 `ask`；运行中可切换，只对当前 session 生效，resume 时回到默认值。
_Avoid_: yolo（仅作 CLI 别名 `--yolo`）, approval mode, trust level

**Permission Review**:
`auto-review` 模式下，对单次工具调用发起的一次独立模型调用，判断风险等级（low / medium / high）并给出 allow 或 deny。它看用户指令和历史工具调用，不看 assistant 文本和工具结果。deny 或评审失败都转为向用户 ask。
_Avoid_: classifier, auto approval, safety check

**Session 访问范围（Session Access Scope）**:
Agent Core 用于文件工具 Permission Mode 默认值的真实路径范围。cwd 与附加目录可读写，已发现技能根目录与本 Session 的 Background Job 输出目录只读；子 Session 共享父范围。范围内默认放行，范围外或只读范围内写入按 Permission Mode 询问、评审或放行。显式权限规则与 hooks 保持优先，范围不限制 bash 或 MCP，也不是操作系统 sandbox。见 [ADR-0044](docs/adr/0044-session-access-scope.md) 与[权限参考](docs/permission-rules.md#session-访问范围)。

## 独立工作树

独立工作树是 Git Project 新建 Session 时从当前分支（detached HEAD 时为当前提交）派生的隔离 Git 工作目录。每棵工作树绑定一个 Session，应用数据库保存源仓库、派生分支、目录与创建时间，Session 绑定保存 `worktreeId`。其 cwd 为工作树目录，附加目录排除 Project 主目录，信任从所属 Project 派生。工作树 Session 不随主目录变更同步且不能 Session Move；删除 Session 或移除 Project 保留工作树与分支。创建、信任与生命周期见 [ADR-0045](docs/adr/0045-git-worktree-sessions.md)。
