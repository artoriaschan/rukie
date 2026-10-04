# 06: 子代理

Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04

## Question

子代理在 Neant 里是什么、Agent Core 如何提供？

地基 A/B/C 已各自定下子代理的交互转发、transcript 存储、权限继承；本工单在此之上定：

- 领域定义（入 `CONTEXT.md`）：子代理与 Session / Run 的关系。
- 模型工具 schema；预定义子代理类型（类似 Explore）是否需要、如何配置（文件格式与加载位置，比照 skills）。
- 上下文隔离：系统提示、工具集、是否继承父历史；结果返回形态。
- 并发：同一 turn 多个子代理并行；取消传播；嵌套深度。
- TUI 呈现与 Headless CLI stream-json 事件。

## Answer

2026-10-04 grilling 结论（术语 **Subagent** 已入 `CONTEXT.md`，**Run** 条目同步）。参考：[子代理参考实现调研](04-research-subagent-prior-art.md)、deepseek-harness `packages/subagent/`、dsh-TUI `SubagentMessage` / `SubagentDashboard` / `SubagentDetailScene`。

### 领域与生命周期

1. **Subagent = 父 session 创建的子 session，可跑多个 run。** 首个 run 由 `subagent` / `subagent_fork` 发起，后续由 `send_message` 发起；agent id 即子 session id。全部 continuable，无 one-shot / job 模式。
2. **默认后台。** `run_in_background` 默认 `true`：立即返回 `started subagent <id>`，父代理继续工作；`false` 时阻塞并直接返回最终文本。
3. **父 run 等待名下运行中的子代理全部结束才结束。** 子代理结束时，通知以 user 消息经 pi steer 注入父 run："Subagent <id> finished|failed: <error>|aborted. Its closing message: <最后一条非空 assistant 文本>"（没有文本则省略后半句）。父模型某 turn 无工具调用但仍有运行中的子代理时，父 run 挂起等待。TUI 与 Headless 行为一致。
4. **嵌套深度 1**：子代理工具集不含 `subagent*` / `send_message` / `list_agents`。
5. **并发**：pi 默认 parallel；同时 running 的子代理上限 8，超出时工具报错。
6. **取消**：父 run 中止 → 级联中止所有 running 子代理，不发通知。用户可在 TUI 单独中断某个子代理（`session.interruptSubagent(id)`，见第 20 条），父代理收到 `aborted` 通知。模型侧不提供 `interrupt_agent`。

### 模型工具

7. **`subagent`**：`description`（必填，3–5 词，由模型概括委派内容，作为卡片、面板、dashboard 的标题）、`prompt`、`subagent_type?`、`run_in_background?`。无 provider / model 参数。
8. **`subagent_fork`**：`description`、`prompt`、`run_in_background?`。复制父代理到最后一个已完成 turn 为止的消息（不含当前进行中的 turn），写入子 transcript 自己的 entry，resume 不依赖父 session。系统提示、工具集、模型均与父相同。显示为 `[fork]`。
9. **`send_message`**：`agent_id, message`，只允许父 → 子，且只能发给本父 session 的子代理。子代理正在跑时 steer 进去；空闲时在子 session 里开一个后台 run，按第 3 条通知；跨进程 resume 后从 Session Store 冷恢复。返回 "delivered"。沿用子代理创建时的 description。
10. **`list_agents`**：无参数，每行 `<id> [running|idle] — <description>`。数据来自父 session 的 Tool State `subagents`：`[{id, description, type}]`。running 状态易失，只在内存里（地基 B 第 4 条）。

### 类型与配置

11. **内置类型**：`general-purpose`，拿父代理的全部工具，去掉第 4 条所列工具；`explore`，只有 `read`、`glob`、`grep`、`skill`、`todo_write`，有回调时加 `ask_user_question`，不含 bash 和 MCP 工具。
12. **自定义类型**：`.neant|.claude|.agents/agents/*.md`，用户层 + 项目层，比照 skills 加载；项目层不需要 trusted（只能收窄）。frontmatter 为 `name, description, tools?, model?`，正文作为附加系统提示。`tools` 与 general-purpose 的工具集取交集。类型清单以 name + description 写进 `subagent` 工具描述。
13. **模型**：类型 frontmatter 的 `model` → settings 的 `subagentModel` → 父模型，取值语法同 `settings.model`。`subagent_fork` 一律用父模型。

### 上下文与权限

14. **`subagent` 的上下文**：父 System Prompt + 委派说明 + 类型正文；Project Instructions、skills 等 reminder 照常注入；不继承父历史，首条 user 消息即 `prompt`。
15. **权限**：按地基 C 第 7 条按引用共享父判定配置，只能收窄；ask 按地基 A 经顶层回调转发并带 `origin`，并发请求按现有 FIFO 排队；Headless 下 fail-closed。`ask_user_question` 与 `todo_write` 可用，子代理的 Todo List 记在自己的 Tool State。
16. **存储**：子 session 经 `parentSessionId` 链接父 session；带 `parentSessionId` 的 session 不出现在 TUI resume 列表和 `--resume` 里。
17. **token 计量**：父 `RunResult.usage` 累加子代理 usage；Context Usage 只算父上下文；子 session 的 usage 记在自己的 transcript。

### Frontend

18. **事件**：子 session 的全部 SessionEvent 包装成 `{ type: "subagent_event", agentId, event }` 转发到父 `onEvent`。frontend 自己根据这些事件算 running 数，不另加事件。
19. **Headless CLI**：stream-json 直接输出 `subagent_event`；text 模式只输出父代理的最终文本。
20. **TUI，完全复刻 dsh-TUI**（UI、样式、交互）：
    - **消息流卡片**（`SubagentMessage`）挂在发起的工具卡（`subagent` 或 `send_message`）处。头行依次为：状态符号（spinner / 🟢🔴）、`子代理：` + description、`provider/model`、effort（父 thinking 级别，没有则省略）、时长、tok、tools、状态。运行中下面有一行当前工具 + 固定 3 行输出，结束后只剩头行，失败时多一行 `└ error`。点击进入详情。不显示 one-shot/continuable 徽标。
    - **dashboard**：Ctrl+A 打开，内容为计数、卡片列表；↑/↓ 移动，Enter 或点击进详情，Esc 关闭。
    - **详情页**（`SubagentDetailScene`）：固定头部；summary / output / tools 三页，←/→ 切换；output 页运行中自动跟随到底部；`x` 中断（调用 `session.interruptSubagent(id)`）；Esc 返回进入前的位置（dashboard 或 chat，chat 保持滚动位置）。
    - **屏幕切换**：在 chat 屏幕内用 state 做整屏 early return，不引入路由层。
    - **子代理面板**：复用 todo 面板的 UI 和交互。root 行 `▾ 子代理 running/total`，点 root 切换折叠，折叠状态独立于 todo，不和 Ctrl+Q 共用。每个节点一行：状态符号、`[type]`、description；点节点进入详情。空闲时隐藏已结束的子代理；折叠时只显示一个正在运行的节点作预览。
21. **输入框上方的面板顺序**在一处固定声明，从上到下：ScrollToBottom → ActivityLine → TodoPanel → SubagentPanel → QuestionDialog → PermissionDialog（最底层）→ PromptInput（有交互时隐藏）→ StatusLine。所有面板同时显示，有审批框时不再隐藏 todo 面板。高度先保证 Permission / Question 两个对话框完整显示，剩余行数由 Todo 与 Subagent 两个面板平分（一方为空时另一方用全部），不够时各自折叠成 1 行预览。

## Comments

- 2026-10-04：[hooks](12-hooks.md) 定子代理类型 frontmatter 可声明 hooks（仅该子代理运行时生效，项目层需 Trusted Project），并有 SubagentStart / SubagentStop 事件。
