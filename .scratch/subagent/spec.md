Status: resolved

# Spec: 子代理（Subagent）

来源：[子代理](../agent-core-roadmap/issues/06-subagent.md)；基于 [地基 A：交互通道](../agent-core-roadmap/issues/01-interaction-channel.md)、[地基 B：工具状态进 transcript](../agent-core-roadmap/issues/02-tool-state-in-transcript.md)、[地基 C：工具调用前后拦截点](../agent-core-roadmap/issues/03-tool-call-interception.md)；参考 [子代理参考实现调研](../agent-core-roadmap/issues/04-research-subagent-prior-art.md)。

## Problem Statement

Neant 的 agent 只能单线程工作。大范围搜索、并行调查、独立的小任务都挤在同一个上下文里：读进来的文件和中间结果很快占满上下文窗口，触发 compaction，模型丢掉早先的细节。几件互不相关的事也只能排队做。用户没法让 agent 把一件事交出去、自己继续做别的，也看不到被交出去的那部分进展到哪了。

## Solution

模型可以创建 Subagent：一个由父 session 派生的子 session，在后台独立运行，结束时把最终文本作为一条消息交回父代理。`subagent` 从空历史开始，只带一段委派 prompt；`subagent_fork` 带着父代理已完成的 turn 开始。父代理可以经 `send_message` 让某个子代理继续，经 `list_agents` 查看所有子代理。父 run 要等名下运行中的子代理全部结束才结束，所以 TUI 和 Headless CLI 都能拿到完整结果。

子代理与父 session 共享权限判定配置，只能收窄；它的询问经同一个 frontend 回调转发并标明来源。子代理不能再创建子代理。用户可以定义自己的子代理类型（工具集、附加系统提示、模型），放在 `agents/*.md` 里。

TUI 完全复刻 dsh-TUI 的子代理呈现：消息流里的实时卡片、Ctrl+A dashboard、可分页的详情页。输入框上方新增子代理面板，复用 todo 面板的样式和交互，点击节点进入详情。输入框上方各个面板改为在一处声明固定顺序，审批框始终在最底层，所有面板同时显示。

## User Stories

### 模型侧

1. 作为模型，我想用 `subagent` 把一件独立的事委派出去，这样大量中间结果不会占满我的上下文。
2. 作为模型，我想让子代理默认在后台运行，`subagent` 立即返回 `started subagent <id>`，这样我可以继续做别的事。
3. 作为模型，我想在需要立即拿结果时传 `run_in_background: false`，这样工具结果里直接就是子代理的最终文本。
4. 作为模型，我想在子代理结束时收到一条消息，内容为结束原因和它最后一条非空回复，这样我不用轮询。
5. 作为模型，我想在一次回复里发起多个 `subagent` 调用并行运行，这样几件互不相关的事可以同时进行。
6. 作为模型，我想用 `subagent_fork` 创建一个带着我已完成 turn 的子代理，这样它不用重新了解我已掌握的上下文。
7. 作为模型，我想用 `send_message` 让一个已结束的子代理继续，它保留自己的历史，这样追问不用从头再来。
8. 作为模型，我想在子代理还在运行时用 `send_message` 给它补充指示，这样它能在下一步就看到。
9. 作为模型，我想用 `list_agents` 看到所有子代理的 id、状态和 description，这样我知道能给谁发消息。
10. 作为模型，我想在 `subagent` 工具描述里看到可用的子代理类型及其说明，这样我能选最合适的 `subagent_type`。
11. 作为模型，我想在 `subagent_type` 不存在时收到明确的报错，列出可用类型，这样我能改正后重试。
12. 作为模型，我想在 running 子代理达到 8 个时收到报错，这样我知道要等一部分结束。
13. 作为模型，我想在 `send_message` 指向不存在或不属于我的子代理时收到报错，这样我不会误以为消息已送达。
14. 作为模型，我想在父 run 还有运行中的子代理而我没有工具调用时，等到子代理结束的消息到来，这样我能汇总它们的结果再结束。
15. 作为子代理里的模型，我想看到 Project Instructions 和 skills 清单，这样我遵守与父代理相同的项目约定。
16. 作为子代理里的模型，我想有自己的 `todo_write`，记在我自己的 Todo List 里，这样我的任务清单不会污染父代理的。
17. 作为子代理里的模型，我不会看到 `subagent`、`subagent_fork`、`send_message`、`list_agents`，这样委派只有一层。
18. 作为 `explore` 类型的子代理，我只有只读工具，这样调查任务不会改动工作区。

### 用户与配置

19. 作为用户，我想在 `.neant/agents/*.md`（也认 `.claude/agents`、`.agents/agents`）里定义子代理类型，frontmatter 为 `name, description, tools?, model?`，正文为附加系统提示，这样我能按项目习惯定制。
20. 作为用户，我想在用户主目录和项目目录都能放类型定义，项目层覆盖同名的用户层定义，这样个人类型和项目类型都可用。
21. 作为用户，我想让自定义类型的 `tools` 只能从 general-purpose 的工具集中取交集，这样项目里的类型定义无法放宽权限，也不需要 trusted。
22. 作为用户，我想在类型定义里或 settings 的 `subagentModel` 里为子代理指定模型，这样可以让便宜的模型做调查。
23. 作为用户，我想让 `subagent_fork` 总是使用父模型，这样它能复用父代理的 prompt cache。
24. 作为用户，我想在类型定义格式错误时看到带文件路径的警告，其余类型照常可用，这样一个坏文件不会让子代理整体不可用。
25. 作为用户，我想让子代理沿用我当前的 Permission Mode 和 Permission Rule，父 session 切换模式时子代理实时生效，这样不会多出一条绕过权限的路。
26. 作为用户，我想在审批框里看到请求来自哪个子代理，这样我知道是谁要执行这条命令。
27. 作为用户，我想在子代理向我提问时看到它来自哪个子代理，并且多个请求按顺序排队，这样并发的子代理不会争抢输入框。
28. 作为用户，我想让 `RunResult.usage` 包含子代理消耗的 token，这样我看到的是这次 run 的真实花费。
29. 作为用户，我想在中止父 run 时所有运行中的子代理一并停下，这样不会有后台进程继续花钱。
30. 作为用户，我想 resume 一个父 session 后仍能让模型 `send_message` 给之前的子代理，这样长任务跨进程也能继续。
31. 作为用户，我不想在 resume 列表里看到子代理的 session，这样列表只包含我自己开的对话。

### TUI

32. 作为 TUI 用户，我想在消息流里看到每个子代理的卡片，头行依次为状态符号、`子代理：` + description、`provider/model`、effort、时长、tok、tools、状态，这样一眼看清它的进展。
33. 作为 TUI 用户，我想在子代理运行时看到卡片上的当前工具行和固定 3 行最近输出，这样我知道它在做什么，同时卡片高度不跳动。
34. 作为 TUI 用户，我想在子代理结束后卡片只剩头行，失败时多一行 `└ error`，这样消息流保持紧凑。
35. 作为 TUI 用户，我想点击卡片进入该子代理的详情页，这样能看完整过程。
36. 作为 TUI 用户，我想按 Ctrl+A 打开 dashboard，看到 running / completed / failed 计数和所有子代理卡片，用 ↑/↓ 移动、Enter 或点击进入详情、Esc 关闭，这样能在多个子代理之间快速切换。
37. 作为 TUI 用户，我想在详情页看到固定头部，并用 ←/→ 在 summary / output / tools 三页间切换，这样能按需查看结论、过程或工具调用。
38. 作为 TUI 用户，我想让详情页的 output 页在子代理运行时自动跟随到底部，这样像 `tail -f` 一样看实时输出。
39. 作为 TUI 用户，我想在详情页按 `x` 或点击 `X interrupt` 中断一个正在运行的子代理，父代理收到 `aborted` 通知并继续，这样能叫停跑偏的子代理而不中止整个 run。
40. 作为 TUI 用户，我想在详情页按 Esc 回到进入前的位置（dashboard 或 chat，chat 保持滚动位置），这样不会丢失阅读位置。
41. 作为 TUI 用户，我想在输入框上方看到子代理面板，root 行为 `▾ 子代理 running/total`，每个节点一行显示状态符号、`[type]`、description，这样不翻消息流也知道谁在跑。
42. 作为 TUI 用户，我想点子代理面板的 root 行切换折叠，折叠状态与 todo 面板相互独立，这样两个面板可以分别收起。
43. 作为 TUI 用户，我想点子代理面板的节点直接进入该子代理的详情页。
44. 作为 TUI 用户，我想在全部子代理结束后立即隐藏自动列表，即使父代理仍在工作；resume 的历史身份仍可在 dashboard 查看，继续运行时再展示。
45. 作为 TUI 用户，我想在审批框或提问框打开时，todo 面板和子代理面板仍然显示，审批框始终紧贴输入框，这样批准时还能看到上下文。
46. 作为 TUI 用户，我想在终端高度不够时让 todo 面板和子代理面板各自折叠成 1 行预览而不是消失，这样小窗口里也不会丢信息。
47. 作为 TUI 用户，我想在父代理等待子代理时看到状态行显示 `waiting for N subagents`，并能用 Esc 中止整个 run。

### Headless CLI

48. 作为 Headless CLI 用户，我想在 stream-json 输出里拿到 `subagent_event`，内含 `agentId` 和原样的子 session 事件，这样我的脚本能追踪子代理。
49. 作为 Headless CLI 用户，我想在 text 模式只看到父代理的最终文本，这样输出可直接给其他程序使用。
50. 作为 Headless CLI 用户，我想让子代理的权限询问按 deny 处理、不出现 `ask_user_question`，与父 session 一致，这样无人值守时不会挂起。

## Implementation Decisions

### Agent Core：新模块 `subagents/`

- 新增 `packages/agent` 的 `subagents/` 概念目录（对应 `CONTEXT.md` 的 Subagent），经 `index.ts` 暴露。职责：类型加载、子 session 的创建 / 冷恢复 / 运行、running 表、通知、四个模型工具。
- 子代理复用 `createSession`，不另写一套 agent loop。`SessionOptions` 增加只供内部使用的参数：父 session 的引用（共享判定配置、交互回调、事件转发）、`parentSessionId`、工具集过滤、附加系统提示、fork 的初始消息、深度标记。对外 API 不暴露这些参数；frontend 仍只用现有选项。
- 子 session 经 pi `SessionCreateOptions.parentSessionId` 创建。父 session 中的工具 `details` 记 `childSessionId`（地基 B 第 9 条）。`store.list` 的调用方（TUI resume 列表、CLI `--resume` 查找）过滤掉带 `parentSessionId` 的 session。
- **running 表**是父 session 内存中的 `Map<agentId, { run, abort, description, type }>`。同时 running 上限 8，超出时工具返回错误，不排队。`// ponytail:` 注明上限为固定值，需要时再做成配置。

### 模型工具

- `subagent`：`{ description: string, prompt: string, subagent_type?: string, run_in_background?: boolean }`。`run_in_background` 默认 `true`。后台模式返回 `started subagent <id>`；前台模式等子 run 结束，返回最后一条非空 assistant 文本，失败或中止时 `isError`。前台模式下子代理不再发结束通知，结果已在 tool result 里。
- `subagent_fork`：`{ description, prompt, run_in_background? }`。复制父代理到最后一个 `turn_end` 为止的消息，不含当前进行中的 turn。消息写进子 transcript 自己的 entry，冷恢复不读父 session。系统提示、工具集、模型均同父。type 记为 `fork`。
- `send_message`：`{ agent_id, message }`。只能发给本父 session 的子代理：
  - 目标正在运行：经子 Agent 的 pi `steer` 注入。
  - 目标空闲：开一个后台 run（父 session 已打开但目标不在内存时，先按 id 冷恢复）。
  - 返回 `delivered to <id>`。
  - id 不存在：返回错误。
  - 目标空闲且 running 已达上限：返回错误。
- `list_agents`：无参数。每行 `<id> [running|idle] — <description>`，没有子代理时返回 `(no subagents)`。
- `subagent` 的工具描述里列出可用类型（`name: description`），每次 run 开始时刷新，与 skills 清单同时机。
- 四个工具只注册在深度 0 的 session 里。工具名不存在于子代理的工具集中，所以模型看不到。

### 父 run 等待与结束通知

- 子 run 结束（完成、失败、被 `interruptSubagent` 中止）时，生成一条 user 消息："Subagent <id> (<description>) finished|failed: <error>|aborted. Its closing message:\n<文本>"。没有文本时省略后半句。
- 父 Agent 正在 run：经 pi `steer` 注入，在当前工具执行完成后、下一次模型调用前送达，不打断工具执行。父 Agent 已停下但父 run 在等待子代理：以这条消息开始下一次模型调用。
- 父 run 的结束条件改为：pi agent 停下，且 running 表为空，且没有尚未送达的通知。agent 停下而 running 表不空时，等待下一条通知到达，再以它继续。等待期间父 run 处于挂起状态，`signal` 中止照常生效。
- 父 run 中止（`signal`）：中止 running 表里所有子 run，不发通知，等它们的存储关闭后父 run 再结束。
- 通知消息作为普通 user 消息进入父 transcript。结束原因的措辞是给模型看的，不经 i18n。

### 类型

- 内置 `general-purpose`：父代理的全部工具（含 MCP 工具），去掉四个子代理工具。内置 `explore`：`read`、`glob`、`grep`、`skill`、`todo_write`，有 `onQuestion` 时再加 `ask_user_question`。
- 自定义类型：从 `<root>/{.neant,.claude,.agents}/agents/*.md` 加载，root 为用户主目录和项目目录，遍历方式与 skills 相同。项目层覆盖同名用户层，自定义覆盖同名内置。`fork` 是 `subagent_fork` 的系统保留类型名：同名自定义文件带路径告警后跳过，普通 `subagent_type: "fork"` 按未知类型报错。frontmatter 为 `name`（必填）、`description`（必填）、`tools?: string[]`、`model?: string`；正文为附加系统提示。`tools` 与 general-purpose 工具集取交集，未知工具名告警后忽略。解析失败的文件经 `onWarning` 告警（带路径）后跳过。项目层不要求 trusted。
- 子代理的系统提示为：父 System Prompt + 一段固定的委派说明（说明自己是子代理、最终回复会交回父代理、不能扩大权限）+ 类型正文。reminder 走子 session 自己的 reminder 机制：Project Instructions、skills、date 照常注入。

### 模型与配置

- `SettingsSchema` 增加 `subagentModel?: string`，语法同 `model`，用户层和项目层都可写（同 `model` 的现有规则）。
- 子代理模型的取值顺序：类型 `model` → `settings.subagentModel` → 父模型。`subagent_fork` 一律用父模型。解析复用 `resolveModel`；解析失败时 `subagent` 返回错误，不回退到其他模型。
- 子代理的 thinking 级别沿用父 session 的 `settings.thinking`。

### 权限与交互

- 子代理的权限关口按引用使用父 session 的配置：`getMode` 读父的当前 Permission Mode，规则和会话级 allow 规则是同一个集合。子代理里"本 session 允许"写进父的会话级 allow 规则集合，对父和其他子代理都生效（同一 session 树）。
- `PermissionAskRequest` 和 `QuestionRequest` 增加 `origin?: { agentId: string; description: string }`，只在子代理发起时存在。frontend 用它标注来源。现有 FIFO 槽位保持不变。
- 子代理不注册 `onQuestion` 之外的交互。父 session 没有 `onQuestion` 时，子代理也没有 `ask_user_question`。

### Tool State 与 resume

- 父 session 新增 Tool State `subagents`：`[{ id, description, type }]`，version 1，每创建一个子代理写一份完整快照。running 状态不持久。
- resume 父 session 后，`list_agents` 列出全部为 idle。`send_message` 按 id 冷恢复：以子 session id 作 `resumeId` 调用内部 `createSession`，并带上与创建时相同的类型配置。类型定义已被删除时回退到 `general-purpose`，并告警。
- 子 session 自己的 Tool State（如 todo）只在子 transcript 里。

### usage

- 子 run 的 `RunResult.usage` 在子 run 结束时累加进当前父 run 的 `RunResult.usage`。父 run 已结束后才结束的子 run 不存在（父 run 等待所有子 run）。Context Usage 只按父上下文计算。

### Session API 与事件

- `Session` 增加 `interruptSubagent(id: string): void`：中止该子代理当前的 run，不存在或空闲时为 no-op。父代理按通知规则收到 `aborted`。
- `CustomSessionEvent` 增加 `{ type: "subagent_event"; agentId: string; description: string; subagentType: string; event: SessionEvent }`。子 session 的每一个事件都包装后经父 `onEvent` 发出，顺序与子 session 内一致。外层 `sessionId` 是父 session id，内层 `event.sessionId` 是子 session id。
- 子代理工具的 tool result `details` 带 `{ agentId, childSessionId }`，TUI 用它把卡片挂到发起的工具卡上。

### Headless CLI

- stream-json：`subagent_event` 原样输出，不再拍平。
- text：只输出父代理的最终文本。子代理事件全部忽略。
- Headless 不提供 `onPermissionAsk` / `onQuestion`，子代理的 ask 按 deny 处理，工具集里没有 `ask_user_question`（与父一致）。

### TUI

- **子代理状态**：chat 屏幕从 `subagent_event` 折叠出每个子代理的视图模型（状态、description、type、model、开始 / 结束时间、tok、工具调用数、当前工具、输出行、工具列表、错误）。这是纯函数，放在 `screens/chat/` 下，与现有 `conversation.ts` / activity 并列。父 session resume 时从 `subagents` Tool State 初始化为 idle 条目，保留在 Ctrl+A dashboard / 详情页，不据此展示自动子代理面板。
- **消息流卡片**：新增 ③ 层组件 `subagent-message`，props only，完全复刻 dsh-TUI `SubagentMessage`：
  - 无边框，`paddingLeft=2`。
  - 头行依次为：spinner（`/activity` 预设，120ms）或 🟢/🔴；粗体 `子代理：` + description；然后各项之间用 dim `·` 分隔：`provider/model`、effort（父 thinking 级别，没有则省略）、时长、`N tok`、`N tools`、彩色状态。
  - 颜色：completed 为 `success`，failed / aborted 为 `error`，running 为 `warning`。hover 时符号和标题变为 `accent`。
  - 运行中多一行当前工具 `· ✓prevTool · runningTool (args…)`，再加固定 3 行 dim 的 `  │ <line>`。
  - 结束后只剩头行，失败时多一行 `  └ <error>`。
  - 点击进入详情。卡片挂在 tool result `details.agentId` 对应的工具卡下；`send_message` 发起的 run 挂在该 `send_message` 工具卡下。
- **dashboard**：新增 ③ 层组件 `subagent-dashboard`，复刻 dsh-TUI `SubagentDashboard`：
  - 标题 `Divider`；计数（running 为 `accent`，completed 为 `success`，failed 为 `error`）和 ✕ 按钮。
  - 卡片列表放在 `ScrollBox` 里，`maxHeight = rows-10`，卡片之间用 dim `─` 分隔。
  - 按键：↑/↓ 移动焦点并滚动；Enter 或点击进入详情；Esc 或 Ctrl+C 关闭；其他输入全部吞掉。
- **详情页**：新增 ③ 层组件 `subagent-detail`，复刻 dsh-TUI `SubagentDetailScene`，不显示 one-shot / continuable 徽标：
  - 固定头部：符号、标题、状态、✕；一行 model、时长、tok、tools；一行开始 / 结束时间和 id。
  - summary / output / tools 三页，用 ←/→ 或点击 tab 切换。body 为 `ScrollBox`，`maxHeight = rows-14`。
  - output 页：连续的 thinking 折叠成一行；正文用 Markdown 渲染；工具行为 `● ` + `accent`；结束后在最后一段正文前加 `── Conclusion ──`；运行中自动跟随到底部。
  - 按键：Esc 或 Ctrl+C 返回；↑/↓ 滚动；`x` 或点击 `X interrupt` 调用 `session.interruptSubagent`；在 output 页 Enter 切换 thinking 折叠。
- **屏幕切换**：chat 屏幕的 state 记录 `{ view: "chat" | "dashboard" | { detail: agentId, from: "chat" | "dashboard" } }`。dashboard 和详情页整屏 early return（照 dsh 做法），不引入路由层。Ctrl+A 打开 dashboard。从详情页返回 chat 时恢复原滚动位置。chat 屏幕以外的视图打开时，run 继续进行，事件照常折叠。
- **子代理面板**：新增 ③ 层组件 `subagent-panel`，复用 todo 面板的结构和 design-system 部件：
  - root 行 `▸/▾ 子代理 running/total`，hover 背景同 todo；点 root 切换折叠，折叠状态是 chat 屏幕里独立的 state。
  - 节点每行：状态符号、`[type]`、description；点节点进入详情。
  - 只有至少一个实际 running 子代理时展示面板；恢复出的 idle 身份不进入面板。其余已结束节点可作为运行上下文保留；全部子代理完成、失败或中止后立即收起，即使父 Run 仍在工作。没有可见面板时不预留高度，Todo 使用剩余空间。父代理普通请求或 `list_agents` 不重新展示历史列表；`send_message` 真正开启子 Run 后才重新展示。
  - 折叠时只显示第一个 running 节点作预览。
  - 高度预算逻辑与 todo 面板一致。可抽出两者共用的预算函数。
- **面板顺序**：chat 屏幕在一处声明输入框上方区域的固定顺序：ScrollToBottom → ActivityLine → TodoPanel → SubagentPanel → QuestionDialog → PermissionDialog → PromptInput → StatusLine。去掉"有审批框时隐藏 todo 面板"。高度分配：先满足 PermissionDialog 和 QuestionDialog 的需要，剩余行数由 TodoPanel 与 SubagentPanel 平分（一方为空时另一方用全部）；某个面板分到的行数小于其最小展开高度时，以折叠预览（1 行）显示。
- **父代理等待**：所有 running 子代理都在跑、父 agent 本身空闲时，StatusLine / ActivityLine 显示 `waiting for N subagents`（新文案进 i18n）。Esc 照常中止整个 run。
- **审批框 / 提问框**：有 `origin` 时，标题前显示 `子代理：<description>`（文案进 i18n）。
- 所有新文案走 `@neant/i18n` 的 TUI 词典，zh / en 齐全。

## Testing Decisions

- 好的测试只看外部行为：模型收到的 tool result 和消息文本、发出的事件、`RunResult`、`session.messages`、Tool State、屏幕快照、CLI 输出。不断言 running 表、视图模型折叠函数等内部结构。
- **e2e `createSession` + faux model**（主接缝，prior art 为 `tests/e2e/todo.test.ts`、`questions.test.ts`、`permissions.test.ts`）。父子代理共用一个 faux core，按调用顺序编排回复。覆盖：
  - `subagent` 后台模式立即返回 id；父 run 等待子 run；结束通知的文本与送达时机（父代理在跑时 steer，父代理已停下时开启下一次模型调用）。
  - 前台模式直接返回最终文本，失败时 `isError`，且不再发通知。
  - 一次回复里多个 `subagent` 并行；第 9 个 running 时报错。
  - 子代理工具集里没有四个子代理工具；`explore` 只有只读工具；自定义类型 `tools` 取交集；未知 `subagent_type` 报错并列出可用类型。
  - `subagent_fork` 的子代理首次请求里包含父代理已完成的 turn，不含当前 turn。
  - `send_message`：给运行中的子代理 steer；给空闲的子代理开新 run 并通知；错误 id 报错；resume 父 session 后冷恢复。
  - `list_agents` 的输出；resume 后全部为 idle。
  - 父 `signal` 中止级联到所有子 run 且不发通知；`interruptSubagent` 后父代理收到 `aborted` 并继续。
  - 子代理的 ask 带 `origin` 经父回调转发；Headless（无回调）下 deny；子代理"本 session 允许"对父生效；父切换 Permission Mode 对运行中的子代理立即生效。
  - `RunResult.usage` 累加子代理用量；`subagent_event` 包装与顺序；子 session 不出现在 `store.list` 过滤后的结果里。
  - 类型加载：临时目录里写 `agents/*.md`，断言 `subagent` 工具描述、项目层覆盖用户层、坏文件告警后其余类型照常可用。
  - 模型选取：类型 `model` > `subagentModel` > 父模型；fork 固定为父模型（用 faux 的多个 model 区分）。
- **settings 加载**（prior art 为 `tests/config/settings.test.ts`）：`subagentModel` 的解析与非法值报错。
- **TUI e2e：`tests/helpers/app` 的 `start()` + 屏幕快照**（prior art 为 `tests/e2e/todo-panel.test.ts`、`permissions.test.ts`、`questions.test.ts`）：
  - 卡片在运行中 / 完成 / 失败三种状态下的渲染。
  - 点击卡片进入详情；Ctrl+A 打开 dashboard，↑/↓、Enter、Esc 可用；详情页 ←/→ 切页、`x` 中断、Esc 返回进入前的位置。
  - 子代理面板：点 root 折叠、点节点进入详情、全部子代理结束即收起、与 todo 折叠互不影响。resume / Rewind 仅保留历史 dashboard 和详情；普通父请求与 `list_agents` 不展示历史 dock，`send_message` 真实运行时恢复面板；隐藏面板不占 Todo 高度。
  - 面板顺序：审批框打开时 todo 面板和子代理面板仍在，审批框紧贴输入框；小高度下两者折叠成预览。
  - 审批框 / 提问框显示 `origin`；`waiting for N subagents` 文案。
- **CLI**（prior art 为 `apps/neant-cli/tests/main.test.ts`）：stream-json 输出 `subagent_event`；text 模式只输出父代理的最终文本。

## Out of Scope

- 嵌套子代理（深度大于 1）。
- 模型侧的 `interrupt_agent` 工具；子代理主动 `send_message` 给父代理。
- one-shot / job 模式、`job_output` 类工具；父 run 结束后子代理仍在后台继续跑。
- 工具参数里的 provider / model 覆盖。
- 子代理 worktree 隔离（CC `isolation`）。
- 多个子代理共享任务表（见地图 Out of scope）。
- running 上限做成配置项。
- server 与桌面端的子代理呈现。

## Further Notes

- 依赖 pi 0.99.2 的 `Agent.steer` 与 `toolExecution: "parallel"` 默认值，以及 `SessionCreateOptions.parentSessionId`。升级 pi 时用 e2e 测试钉住这几处行为。
- 面板顺序重排和"有审批框时不隐藏 todo 面板"会改动现有 TUI 布局与现有测试，适合单独拆成一张工单，且先于子代理面板落地。
- `CONTEXT.md` 的 Subagent、Run 条目已在 grilling 中同步。

2026-10-05 展示纠偏：依据用户“子代理都完成后，就无需展示列表了”，自动 dock 只由真实子 Run 驱动。当前本地 dsh-TUI 的 `src/dsh-adapter/channel/subagent-projection.ts` 将历史身份保留在 dashboard，并用 live discovery / running 证据控制实时卡片；`src/screens/Chat.tsx` 只经显式 dashboard 开关呈现历史列表，没有 Neant 同名 dock。此处 dock 是 Neant 扩展，沿用历史身份与活跃呈现分离的规则。
