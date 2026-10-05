# Neant

Neant 是 coding agent。Agent Core 负责 agent loop、工具、MCP、skills 和上下文注入；Headless CLI、TUI 和以后的桌面端都是驱动它的 frontend。

## Language

### 运行

**Agent Core**:
与界面无关的 agent 运行时。各个 frontend 通过它来运行 session。
_Avoid_: engine, backend

**Frontend**:
驱动 Agent Core 并把 run 呈现给用户的程序：Headless CLI、TUI，以后还有桌面端。
_Avoid_: client, UI

**Headless CLI**:
非交互的 frontend：读入一条 prompt，执行一个 run，输出文本或 stream-json 后退出。不提供任何 Interaction 回调：依赖交互的工具不暴露给模型，Agent Core 自身发起的交互取各自的安全默认值。
_Avoid_: CLI（会和 TUI 混淆）

**TUI**:
运行在终端里的交互式 frontend，在同一个 session 里连续接收 prompt。
_Avoid_: CLI, REPL

**Session**:
用户与 agent 在同一个工作目录下的一段连续对话，可以凭 id 恢复。
_Avoid_: conversation, thread, chat

**Transcript**:
一个 session 中按顺序排列的消息与 Tool State 记录，只追加不修改。模型当时看到的内容，原样记录在里面。
_Avoid_: history, log

**Turn**:
一次模型调用，加上这次调用返回的工具调用。
_Avoid_: step, round

**Run**:
处理一条 prompt，直到 agent 停下为止。prompt 来自用户，或（对 subagent 而言）来自父代理。一个 run 包含一个或多个 turn；父 run 要等它名下运行中的 subagent 全部结束才算结束。
_Avoid_: task, job

**Subagent**:
由父 session 的模型经 `subagent` / `subagent_fork` 创建的子 session，可在父 session 内经 `send_message` 续跑。每个 run 默认在后台进行，父代理继续工作；结束时其最终文本作为一条消息交回父代理。`subagent` 从空历史开始，`subagent_fork` 带着父代理已完成的 turn 开始。判定配置与父 session 共享，只能收窄；不能再创建 subagent。
_Avoid_: task, worker, child agent

**Tool State**:
由工具或 Agent Core 维护、随 transcript 持久化、resume 时重建的 session 级状态，如 todo 列表、Goal。每次变化记一份完整快照，取最后一条有效快照为当前状态。只记录 resume 后仍需看到的事实；"当前进程正在做什么"（如 Goal 是否正在续跑）不属于 Tool State。
_Avoid_: tool data, session state

**Todo List**:
模型为当前 session 维护的任务清单，是一种 Tool State。每项只有内容和状态（待办 / 进行中 / 已完成），每次整表替换。属于单个 session：子代理有自己的 Todo List，不与父 session 共享。与 Goal 相互独立。
_Avoid_: task list, plan

**Checkpoint**:
某条 user prompt 之前、本 session（含其 subagent）用文件工具写过的文件的内容快照。每条 user prompt 一个；bash 造成的改动不在其中。
_Avoid_: snapshot, backup, undo point

**Rewind**:
回到某个 Checkpoint 的动作，可选只回代码、只回对话或两者都回。回对话是把 transcript 分支移回那条 user prompt 之前，原分支仍保留；回代码是把文件还原成 Checkpoint 内容，覆盖之后的任何改动。只在 session 空闲时可用。
_Avoid_: undo, revert, rollback

**Session Store**:
transcript 的持久化位置。Headless CLI 和 TUI 存成 JSONL 文件，桌面端存到 SQLite。
_Avoid_: database, history store

**Locale**:
frontend 呈现文案所用的语言，由 frontend 自行解析。Agent Core 不感知 locale：它产出的内容和 transcript 与 locale 无关，同一个 session 可以在不同 locale 的 frontend 中恢复。
_Avoid_: language（会和模型回复语言混淆）, i18n

**Slash Command**:
用户在 frontend 输入的 `/` 开头的指令，由 frontend 解析并调用 Agent Core 的能力；Agent Core 不感知命令语法。自定义命令是一段 prompt 模板。
_Avoid_: command（会和 bash 命令混淆）

**Goal**:
用户为 session 设定的目标。设定后 agent 在每个 run 结束时自动续跑，直到模型判定目标完成或受阻、用户暂停，或达到续跑上限。
_Avoid_: task, objective

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

**Compaction**:
上下文接近模型上下文窗口时，把较早的 transcript 摘要成一条 entry。之后的 turn 和 resume 都从这条摘要加上它之后的消息继续，原始消息仍保留在 transcript 里。
_Avoid_: summarization, context pruning

**Context Usage**:
当前 transcript 发给模型时占用的 token 数，相对于模型的上下文窗口。总量以 provider 报告为准；按 system / prompt / assistant / thinking / tools 分段只是估算，用来表示占比。
_Avoid_: context size, token count

### 能力

**Tool**:
模型可以调用的动作。来源有三种：内置、来自 MCP server，或者是用来加载 skill 的那个工具。
_Avoid_: function, command

**Skill**:
由 `SKILL.md` 定义的一个指令目录，遵循 Agent Skills 规范。模型一开始只看到它的 name 和 description，需要时才加载正文。
_Avoid_: plugin, recipe

**MCP Server**:
通过 Model Context Protocol 提供工具的外部进程或 endpoint。它的工具命名为 `mcp__<server>__<tool>`。
_Avoid_: connector, integration

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
用户写下的一条 `allow`、`ask` 或 `deny`，按工具名、bash 命令文本或文件路径匹配工具调用。命中的 `deny` / `ask` 在任何 Permission Mode 下都生效，`ask` 规则也不交给 permission review。用户层与项目层合并；项目层的 `allow` 只在 trusted project 生效。审批时"本 session 允许"生成的是只在当前 session 内存中的 allow 规则。规则不是安全边界。
_Avoid_: policy, whitelist, allowTools

**Permission Mode**:
决定 permission decision 如何得出的 session 级开关，三选一：`ask`（只读工具 allow，其余 ask）、`auto-review`（由 permission review 判定，安全的 allow，有风险的 ask）、`full-access`（模式本身不再询问：本该由模式 ask 的都 allow，但用户显式写下的 deny / ask 规则与 hooks 照常生效）。默认 `ask`；运行中可切换，只对当前 session 生效，resume 时回到默认值。
_Avoid_: yolo（仅作 CLI 别名 `--yolo`）, approval mode, trust level

**Permission Review**:
`auto-review` 模式下，对单次工具调用发起的一次独立模型调用，判断风险等级（low / medium / high）并给出 allow 或 deny。它看用户指令和历史工具调用，不看 assistant 文本和工具结果。deny 或评审失败都转为向用户 ask。
_Avoid_: classifier, auto approval, safety check
