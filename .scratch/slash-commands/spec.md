Status: resolved

# Spec: Slash Command 与手动 compaction

来源：[自定义 Slash Command 与手动 compaction](../agent-core-roadmap/issues/16-slash-commands-and-manual-compaction.md)；相关 [撤销改动 / checkpoint](../agent-core-roadmap/issues/13-checkpoint-and-rewind.md)（`/rewind`）、[plan mode](../agent-core-roadmap/issues/10-plan-mode.md)（`/plan`）、[hooks](../agent-core-roadmap/issues/12-hooks.md)（PreCompact / PostCompact）。术语见 `CONTEXT.md` 的 Slash Command、Skill Invocation、Session Title、Compaction。参考：dsh-TUI（命令清单、补全菜单、`/settings`、`/btw`）、deepseek-harness（Session 标题）、Claude Code（`/context`、`/compact [instructions]`）。

## Problem Statement

在 TUI 里，我除了发 prompt 之外几乎什么都做不了：上下文快满时不能主动压缩，也不能告诉摘要该保留什么；想换模型、回到昨天的 session、看清上下文被什么占满，都得退出重开或者翻文件。session 没有可读的标题，恢复时只能靠 id 猜。想顺口问一句不打断当前任务的问题也没有办法。输入 `/` 时看不到有哪些命令和 skill 可用。

## Solution

TUI 提供一组内置 Slash Command，输入 `/` 弹出补全菜单，列出内置命令和用户可调用的 skill。内置命令由 frontend 解析，调用 Agent Core 新增的能力 API：手动 compaction（可带侧重点指令）、切换模型、列出并恢复 session、上下文报告、侧问、改名。Agent Core 自动给 session 起标题：先用首条 prompt，再由模型总结一次；用户手动改名后固定。frontend 匹配不上的 `/` 输入原样交给 Agent Core 尝试 Skill Invocation，仍不中就作为普通 prompt。不做自定义命令，复用的 prompt 写成 skill。Headless CLI 只有 Skill Invocation。

## User Stories

**命令框架与补全**

1. As a TUI 用户, I want 输入 `/` 时弹出命令菜单, so that 我不用记住命令名。
2. As a TUI 用户, I want 菜单同时列出内置命令和用户可调用的 skill, so that 一个入口就能看到所有可用能力。
3. As a TUI 用户, I want 菜单按名字前缀过滤、不区分大小写, so that 多打几个字就能缩小范围。
4. As a TUI 用户, I want 每行显示命令说明, so that 我知道选中后会发生什么。
5. As a TUI 用户, I want skill 行带 `[skill]` 标签, so that 我能区分内置命令和 skill。
6. As a TUI 用户, I want Up/Down 循环选择, so that 列表首尾之间可以直接跳转。
7. As a TUI 用户, I want Tab 把选中项填成 `/name `, so that 我可以接着输入参数。
8. As a TUI 用户, I want Enter 直接执行选中项, so that 无参命令一步完成。
9. As a TUI 用户, I want 多行输入或没有匹配项时菜单不弹出, so that 菜单不干扰正常编辑。
10. As a TUI 用户, I want skill 与内置命令同名时内置命令优先, so that 内置行为不会被项目里的 skill 意外覆盖。
11. As a TUI 用户, I want 输入不认识的 `/foo bar` 时原样发给模型, so that 和 dsh-TUI 一致，不会凭空吞掉我的输入。
12. As a TUI 用户, I want `/Users/x/a.ts 有 bug` 这类以路径开头的输入照常发送, so that 粘贴路径不会被误认成命令。
13. As a TUI 用户, I want `/skill-name 参数` 照旧展开 skill, so that 现有的 Skill Invocation 行为不变。
14. As a TUI 用户, I want run 进行中输入的 `/skill` 随 steer 发出, so that 我可以在任务中途追加 skill 指令。
15. As a TUI 用户, I want run 进行中执行 `/help`、`/btw`、`/context`、`/rename`, so that 查看信息、改名不必等任务结束。
16. As a TUI 用户, I want run 进行中 `/exit` 先中止 run 再退出, so that 退出不会留下半截任务。
17. As a TUI 用户, I want run 进行中执行其他内置命令时看到“run 结束后再用”的提示, so that 我知道命令为什么没生效。
18. As a TUI 用户, I want `/help` 列出所有内置命令和 skill, so that 我能一次看全。
19. As a TUI 用户, I want `/clear` 开一个新 session、旧的仍可 resume, so that 清屏不丢历史。
20. As a TUI 用户, I want `/plan` 直接开关 plan mode, so that 我不必等模型请求进入。
21. As a TUI 用户, I want `/rewind` 打开回退面板, so that 和双击 Esc 的效果一致。
22. As a TUI 用户, I want `/goal` 先出现在清单里, so that 等 Goal 落地后入口已经就位。

**手动 compaction**

23. As a TUI 用户, I want `/compact` 立刻压缩上下文、不看 80% 阈值, so that 我可以在开始新子任务前主动腾出空间。
24. As a TUI 用户, I want `/compact 重点保留 X` 让摘要侧重我指定的内容, so that 压缩后关键细节不丢。
25. As a TUI 用户, I want 手动压缩和自动压缩显示同样的进度与结果通知, so that 体验一致。
26. As a TUI 用户, I want transcript 还没有可压缩的内容时得到明确报错, so that 我知道这次压缩没做。
27. As a TUI 用户, I want 侧重点指令不会作为一条消息留在对话里, so that 它不影响后续 turn。
28. As a hook 作者, I want PreCompact / PostCompact 收到 `trigger: "manual"` 和 `custom_instructions`, so that 我能区分手动压缩并读到指令（对齐 Claude Code）。
29. As a hook 作者, I want PreCompact 能阻断手动压缩, so that 策略对两种触发方式一致生效。
30. As a TUI 用户, I want 手动压缩之后 SessionStart(`compact`) hook 和 reminder 重注入照常发生, so that 压缩后上下文仍然完整。
31. As a resume 用户, I want 手动压缩的结果与自动压缩一样被恢复, so that 重开 session 后看到的是同一个上下文。

**模型切换**

32. As a TUI 用户, I want 不带参数的 `/model` 打开模型选择器, so that 我能在可用模型间挑一个。
33. As a TUI 用户, I want `/model provider/id` 直接切换, so that 熟悉的模型不必走选择器。
34. As a TUI 用户, I want 选择器列出 settings 里配置的模型和内置 provider 的模型, so that 能选的都在里面。
35. As a TUI 用户, I want 切换后从下一次模型调用开始生效、状态栏同步, so that 我看到的就是正在用的模型。
36. As a resume 用户, I want 恢复 session 时沿用最后选的模型, so that 不必每次重选。
37. As a 用户, I want `/model` 不改 `settings.json`, so that 一次临时切换不影响其他 session。
38. As a 用户, I want 继承父模型的子代理从下一个新建的开始用新模型、已在跑的不变, so that 切换不会打断运行中的子代理。
39. As a 用户, I want 写错模型名时得到明确报错、当前模型不变, so that 拼错不会让 session 坏掉。

**Session 列表与恢复**

40. As a TUI 用户, I want `/resume` 列出当前目录下的 session, so that 我能接着以前的工作。
41. As a TUI 用户, I want 每行先显示标题、下一行是 `时间 · 条数 · model`, so that 我能快速认出要找的那个。
42. As a TUI 用户, I want 子 session 不出现在列表里, so that 列表只有我自己开的对话。
43. As a TUI 用户, I want 选中后当前 session 关闭、切换到所选 session, so that 恢复是一步操作。
44. As a TUI 用户, I want 标题只来自首条 prompt 的行用暗色显示, so that 我能分清模型总结的标题和临时标题。

**Session 标题**

45. As a 用户, I want 首条 prompt 发出后 session 立刻有标题（清洗后前 40 字节）, so that 列表里马上能认出它。
46. As a 用户, I want 模型随后把标题总结成一个短句（CJK 约 10 字，其他语言约 5 词，与消息同语言）, so that 标题比截断的 prompt 更好读。
47. As a 用户, I want 生成标题不阻塞当前 run, so that 回复不会因为起标题变慢。
48. As a 用户, I want 生成失败时保留首条 prompt 作标题、只给出告警, so that 起标题失败不影响工作。
49. As a 用户, I want 标题只自动生成一次, so that 它不会在对话中途频繁变化。
50. As a 用户, I want 设置 `titleModel` 用便宜模型起标题、不设则用主模型, so that 我能控制成本。
51. As a TUI 用户, I want `/rename 新标题` 改名, so that 我能给 session 一个准确的名字。
52. As a TUI 用户, I want 不带参数的 `/rename` 把输入框预填为当前标题, so that 我在原标题上微调即可。
53. As a 用户, I want 手动改名后永远不被自动标题覆盖、正在进行的生成被取消, so that 我的命名是最终的。
54. As a 用户, I want 子代理的 session 用委派描述作标题、不调模型, so that 不浪费调用。
55. As a TUI 用户, I want 终端标题显示 `✦ 标题`、运行中换成 spinner, so that 在其他窗口也能看到 session 在做什么。
56. As a Headless 用户, I want headless 跑的 session 也自动起标题, so that 之后在 TUI 里 resume 时认得出。
57. As a frontend 开发者, I want 标题变化时收到 `session_title_changed` 事件（带来源）, so that 界面能实时更新。

**上下文报告 `/context`**

58. As a TUI 用户, I want `/context` 显示一张 token 格子图, so that 一眼看出上下文被什么占满。
59. As a TUI 用户, I want 图例先显示模型名称、模型 ID、`已用/总量 tokens (百分比)` 三行, so that 我知道整体占用。
60. As a TUI 用户, I want 按类别（System prompt、Memory files、System tools、MCP tools、Skills、Messages、Free space、Compaction 预留）列出 token 数和占比, so that 我能定位大头。
61. As a TUI 用户, I want Project Instructions 文件作为 Memory files 单独列出、按路径给 token 数, so that 我能看出哪个 `AGENTS.md` 太大。
62. As a TUI 用户, I want `/context` 显示 MCP tools、Skills、子代理类型摘要，并用 `/context all` 展开明细, so that 我能决定关掉哪个 server 或 skill。
63. As a TUI 用户, I want Compaction 预留显示为窗口的 20%, so that 我明白什么时候会触发自动压缩。
64. As a TUI 用户, I want 窄终端（<80 列）时格子图缩小, so that 布局不会折乱。
65. As a TUI 用户, I want 1M 窗口的模型用 20×10 的格子, so that 细节不被压没。
66. As a TUI 用户, I want 报告是对话流里的一条静态快照、不进 transcript, so that 它不被 resume、也不送给模型。
67. As a TUI 用户, I want 顶部总数优先用最近一次 response 的真实 input tokens, so that 数字尽量准。

**设置界面 `/settings`**

68. As a TUI 用户, I want `/settings` 打开一个全屏设置页（外观和交互同 dsh-TUI）, so that 以后加的设置项有统一的入口。
69. As a TUI 用户, I want 没有设置项时显示一行空状态说明, so that 我知道这里暂时什么都没有。
70. As a TUI 用户, I want Esc 关闭设置页回到对话, so that 进出都轻松。

**侧问 `/btw`**

71. As a TUI 用户, I want `/btw 问题` 根据当前上下文单轮回答一个问题, so that 不打断主任务就能问清一件事。
72. As a TUI 用户, I want 侧问在 run 进行中也能用、不打断主 run, so that 等待时能顺手问。
73. As a TUI 用户, I want 回答在 overlay 里流式显示、Esc 关闭并中止, so that 用完即走。
74. As a TUI 用户, I want 侧问和回答不进 transcript, so that 主对话不被打乱。
75. As a TUI 用户, I want 侧问不带工具、并知道哪些工具调用仍在执行, so that 它不会声称做了做不到的事。
76. As a TUI 用户, I want 空参数的 `/btw` 只提示用法, so that 误触不会浪费调用。

**Headless**

77. As a Headless 用户, I want prompt 里的 `/skill-name` 照常展开, so that 脚本能用 skill。
78. As a Headless 用户, I want `/compact` 这类内置命令名被当作普通 prompt, so that Headless 的行为简单可预测。

## Implementation Decisions

**分层**

- Slash Command 只存在于 frontend；Agent Core 不感知命令语法，只暴露能力 API。Skill Invocation 继续由 Agent Core 现有的 prompt 展开实现，不挪到 frontend。
- 命令名匹配规则：输入以 `/` 开头，后接 `[a-z0-9-]+`，再跟空白或结尾。符合规则且是内置命令 → frontend 执行；否则整行原样作为 prompt 交给 `run()`（Agent Core 再尝试 Skill Invocation，不中即普通 prompt）。
- 不做自定义命令模板（无 `commands/` 目录、无 `$ARGUMENTS`）。

**Agent Core：Session 新增 API**

- `compact(options?: { instructions?: string })`：仅空闲，否则抛错；不检查阈值；没有可压缩内容时抛错。与自动 compaction 共用同一条压缩路径，`instructions` 透传给 pi compaction 的 `customInstructions`，只进入这一次摘要请求。PreCompact 阻断时抛出带 hook 原因的错误。
- `setModel(spec: string)`：`provider/id`，仅空闲；经现有模型解析，失败抛错且不改当前模型。选择作为 Tool State `model` 持久化，resume 时优先于 settings 的 `model`。不写 `settings.json`。子代理沿用父模型时读取当前值，因此只影响之后新建的子代理。
- 可用模型清单：Agent Core 导出列出 settings 自定义模型与内置 provider 模型的函数，供选择器使用。
- `listSessions({ cwd })`（模块级函数，基于 store 的 `list`）：返回当前 cwd 下非子 session 的 `{ id, title, titleSource, updatedAt, messageCount, model }`，按更新时间倒序。
- `rename(title: string)`：写 pi session name，标记来源 `user`；取消进行中的标题生成；空闲与 run 中都可调用。
- `readonly title` / `titleSource`：当前标题与来源（`prompt` / `model` / `user`）。
- `contextReport()`：返回结构化报告（见下）；空闲与 run 中都可调用，只读。
- `sideQuestion(question, { signal })`：返回流式文本的异步迭代或事件回调；空闲与 run 中都可调用。

**Agent Core：Session 标题（新概念目录 `session-title`）**

- 存储：pi session name（`setName` / `getName`），来源另以 Tool State 记录，供 last-wins 与“手动固定”判定。
- 触发：首条 user prompt 写入后立即写 fallback 标题：去控制字符与 ANSI、折叠空白后截到 40 个 UTF-8 字节（不切断码点，不加省略号）。同时异步发起一次模型调用；只针对首条 prompt，之后不再生成。
- 模型调用：单轮、无工具，模型为 settings 新增的可选 `titleModel`，缺省为主模型。system prompt 照 deepseek-harness `session-title-llm`：只返回一行纯文本标题，用消息的语言，非 CJK 约 5 词、CJK 约 10 字。输入上限 4KB，输出上限 64 token，结果截到 80 字节。
- 失败（超时、空输出、调用报错）只发告警通知，保留 fallback。
- 跳过条件：已有 `user` 来源标题、子 session（标题直接取委派描述）。
- 竞争：`rename()` 中止进行中的调用；调用完成时若来源已是 `user`，丢弃结果。
- 事件：新增 `session_title_changed { title, source }`。

**Agent Core：上下文报告（扩展 `context-usage`）**

- 报告字段：`model`、`window`、`used`（优先最近一次 response 的 input tokens，否则估算总和）、`categories[]`（`{ name, tokens }`）、`memoryFiles[]`（`{ path, tokens }`）、`mcpTools[]`（`{ server, name, tokens }`）、`skills[]`（`{ name, tokens }`）、`agentTypes[]`（`{ name, tokens }`）。
- 类别：System prompt（只算系统提示词本身）；Memory files（`user-instructions` 与 `project-instructions` 两个 reminder 的当前内容）；System tools（内置工具定义，含子代理类型清单）；MCP tools；Skills（skills 列表 reminder）；Messages（其余消息与 reminder，不与前几类重复计算）；Compaction 预留（窗口的 20%，与自动 compaction 的 80% 阈值一致）；Free space（剩余部分，不小于 0）。
- 细分估算统一用 chars/4，与现有 `context_usage` 一致。现有 `context_usage` 事件不变。

**Agent Core：侧问**

- 用当前恢复后的上下文，剔除还没有结果的 tool call，再追加一条包裹后的 user 消息。包裹文本照 dsh-TUI `wrapSideQuestion`：只基于已有上下文给一个简短回答，没有工具可用，并列出仍在执行的调用。
- 不带工具、不写 transcript、不触发 hooks 与 reminder、不发 Session 事件。

**Agent Core：手动 compaction 的事件与 hooks**

- `compaction_start` / `compaction_end` 增加 `trigger: "auto" | "manual"`。
- PreCompact / PostCompact hook 输入 `trigger` 取 `manual` / `auto`；手动时带 `custom_instructions`（无指令为空串）。
- 之后的 SessionStart(`compact`) hook 与 reminder 重注入沿用自动路径，在下一条 user 消息时生效。

**`@neant/shared`**

- `SessionEvent`：`compaction_start` / `compaction_end` 加 `trigger`；新增 `session_title_changed`。
- `Settings`：新增可选 `titleModel`。
- 以上是 breaking change，按“暂无外部事件消费者”的约定直接改。

**TUI：命令与补全**

- 内置命令表（名字、说明、run 中是否可用、处理器）由 ④ 层 chat 屏幕持有；文案进 i18n。
- 清单：`compact`、`clear`、`rewind`、`goal`、`plan`、`help`、`exit`、`model`、`resume`、`context`、`settings`、`btw`、`rename`。
- run 中可用：`exit`（先中止 run）、`help`、`btw`、`context`、`rename`；其余命令显示“run 结束后再用”的通知。
- 补全菜单（③ 层组件，只收 props）：单行且以 `/` 开头、有匹配项时显示；名字前缀匹配、不区分大小写；来源是内置命令加用户可调用的 skill，同名时内置优先，skill 行带 `[skill]`；Up/Down 循环；Tab 填为 `/name `；Enter 执行选中项；Esc 关闭菜单。不做参数补全。菜单打开时 Up/Down 归菜单；已开始的输入历史浏览继续拥有方向键，恢复 slash 草稿的同一次按键不再移动菜单选择。Shift+Tab 由菜单消费，不切换 Permission Mode。
- 命令列表复刻 dsh-TUI `CommandSuggestions` / `SuggestionCard`：圆角浮层紧贴输入框顶边，不占消息区布局；标题包含匹配总数，最多显示 5 项并围绕选中项居中，小终端按可用行数缩小窗口。选中项以 suggestion 色的 `❯` 与粗体名字呈现，其他项变暗，匹配前缀保持正常亮度；名称和说明按显示列对齐，说明截断，裁剪时显示 `↑n · ↓n`。边框跟随输入框的 Plan Mode 色；点击执行，悬停高亮鼠标所在可见行，滚轮逐项移动并在首尾停止。
- `/goal`：在 Goal 落地之前提示“尚未支持”。
- `/clear`：dispose 当前 session，用相同 options 新建一个，清空对话区。
- `/plan`：调用 `setPlanMode(!planMode)`。
- `/rewind`：打开现有的回退面板。
- `/help`：列出命令与 skill 的本地静态输出。
- `/rename`：有参数直接调用 `rename()`；无参数时把输入框预填为 `/rename <当前标题>`。

**TUI：选择器与界面**

- 模型选择器、session 选择器：复用现有的面板与选择组件，形态参照 dsh-TUI 的选择器。session 行有两行，第一行是标题（来源 `prompt` 时暗色），第二行是 `时间 · 条数 · model`。
- `/resume`：选中后 dispose 当前 session，以 `resumeId` 重建并重新渲染对话。
- `/context`：③ 层组件，复刻 Claude Code `ContextVisualization`。
  - 布局：命令行与缩进标题，左侧格子图，右侧图例；窄终端或图例空间不足时上下排列，资源摘要放在两者下方。格子默认 10×10；窗口 ≥1M 时 20×10；终端 <80 列时缩到 5×5（1M 为 5×10）。
  - 格子符号：`⛁` 满格、`⛀` 不足 70% 的格、`⛶` 空闲、`⛝` 预留。
  - 图例：模型名称与窗口、模型 ID、`used/window tokens (pct%)` 三行；空一行后显示斜体 `Estimated usage by category` 与非零类别。token 数缩写为 k/m，类别仅符号着色，数字灰色。下方默认显示各资源数量和 token 摘要，`/context all` 展开 `└ name: N tokens` 明细。
  - 使用截图参考配色，作用域限于报告组件。每个非空类别至少占一格。渲染成对话区里的一条本地静态条目，不进 Agent Core transcript。
- `/settings`：新增 ④ 层设置屏幕，复刻 dsh-TUI `Settings` 的框架。
  - 外观：全屏，标题行带 `1/N` 计数；圆角分区卡片；`❯` 指针加选中底色；布尔与枚举的取值样式。
  - 页脚：分隔线、通知行、按键提示。
  - 按键：↑↓、Enter、←→、Esc。
  - 当前不注册任何分区，只显示空状态文案；字段模型留好接口即可，不实现写回。
- `/btw`：overlay，流式显示问题和回答，Esc 关闭并中止；连续发第二个侧问会中止前一个。
- 终端标题：用 OSC 0 写 `✦ <标题>`，运行中把 `✦` 换成 spinner 帧；订阅 `session_title_changed`。

**Headless CLI**

- 不解析内置命令；`/skill-name` 照常经 Agent Core 展开。自动标题照常生成。

## Testing Decisions

- 只测外部行为：Agent Core 经 `createSession` 加 Session API 观察返回值、`messages`、事件、hook 输入和磁盘上的 session；TUI 经 `start()` 驱动 `main`，观察终端输出和 fake model 收到的请求。不测内部函数、截断辅助函数、命令表结构。
- 两个测试入口，不新增其他入口：
  1. Agent Core e2e（`bun:test`，`packages/agent/tests/e2e/`）：`fakeModel` + `tempDirs`。
  2. TUI（`bun:test`，`apps/neant-tui/tests/screens/chat/`）：`tests/helpers/app.ts` 的 `start()` + `controlledModel` + 假终端。
- 测试工具改动：`controlledModel` 要能识别标题生成调用和侧问调用，把它们分到各自的队列，照现有 `controlReviews` 识别 review 调用的方式；主对话的 `calls` 不受影响。
- Agent Core 覆盖场景：
  - `compact()`：低于阈值也会压缩；`instructions` 出现在摘要请求里、不出现在 transcript；`trigger: manual` 的事件与 hook 输入；PreCompact 阻断时抛错；run 中调用抛错；空 transcript 抛错；resume 后上下文与压缩结果一致。
  - `setModel()`：下一次调用使用新模型；resume 后恢复；名字错误时抛错且模型不变；之后新建的子代理使用新模型。
  - 标题：首条 prompt 后立即得到 fallback 标题（截断与清洗）；模型结果替换它并带 `model` 来源；失败时保留 fallback 并告警；只生成一次；`titleModel` 生效；`rename()` 之后不再被覆盖，进行中的生成被丢弃；子 session 用委派描述；`listSessions()` 排除子 session、按时间排序。
  - `contextReport()`：Memory files 按路径计数，且不重复计入 Messages；MCP tools 与 Skills 明细；预留为窗口的 20%；有真实 usage 时 `used` 取真实值。
  - `sideQuestion()`：请求里没有工具定义；未完成的 tool call 被剔除并在包裹文本里注明；transcript 与事件不变；run 中可调用；signal 能中止。
- TUI 覆盖场景：
  - 菜单：`/` 弹出、前缀过滤、`[skill]` 标签、同名时内置优先、Up/Down 循环、Tab 填充、Enter 执行、多行输入不弹出。
  - 未知命令原样发送；以路径开头的输入照常发送。
  - run 中可用的命令能执行；其余命令提示拒绝；`/exit` 先中止 run。
  - `/compact` 带指令时，fake model 收到包含指令的摘要请求。
  - `/model` 的选择器与直接切换；`/resume` 的列表与切换。
  - `/rename` 的预填与改名。
  - `/context` 的格子符号、图例、窄终端布局。
  - `/settings` 的空状态与 Esc 退出。
  - `/btw` 的 overlay 流式显示、Esc 中止、run 中可用。
  - 终端标题的 OSC 输出。
- 参考先例：
  - Agent Core：`tests/e2e/compaction.test.ts`（用小 `contextWindow` 触发压缩）、`compaction-hooks.test.ts`（PreCompact / PostCompact 输入与阻断）、`context-usage.test.ts`、`plan-mode.test.ts`（Tool State 与 resume）、`subagents.test.ts`。
  - TUI：`tests/screens/chat/resume.test.ts`、`status-line.test.ts`、`plan-review.test.ts`（overlay 与按键）、`input-history.test.ts`（Up/Down 冲突）。
  - 界面行为参照 dsh-TUI `PromptInput` / `CommandSuggestions` / `Settings`，以及 Claude Code `ContextVisualization`。

## Out of Scope

- 自定义命令模板（`commands/*.md`、`$ARGUMENTS`、frontmatter）。
- 参数补全（例如 `/model` 后补全模型名）。
- `/context` 的 Suggestions 节，以及 Headless 下的 `/context`。
- `/settings` 的具体设置项、写回、secret 管理。
- 在 `/resume` 选择器内重命名、删除、置顶。
- 标题在之后的 turn 重新生成。
- Headless 解析内置命令。
- `/goal` 的行为（归 Goal 工单）。
- dsh-TUI 其余命令（`/fork`、`/tree`、`/export`、`/theme`、`/cost`、`/doctor` 等）。

## Further Notes

- `/rewind` 的行为已在 [Checkpoint 与 Rewind spec](../checkpoint/spec.md) 定义，这里只负责把它接进命令表。
- 标题生成、侧问与 review 一样属于辅助模型调用，不计入主 run 的 usage 事件，也不经过 hooks。
- dsh-TUI 中，TUI 直接追加的 rename 记录不会取消进行中的生成，可能被晚到的模型标题覆盖。本 spec 明确由 `rename()` 取消生成，并在生成完成时检查来源，避免这个竞争。

## Answer

01–08 全部实现并 resolved，已合并到本地主分支 `main`，合并提交为 `48f74550a2062c8cea9458c3052a4c9daaadcfc4`。完成命令框架与补全、手动 compaction、自动标题与改名、会话恢复、模型切换、上下文报告、侧问，以及设置占位页；工单验收与局部验证记录见 [implementation map](map.md)。

最终代码与测试整合提交：`efd8f67d81773da2e0c02cd1406fa0f28022287a`。在隔离临时 HOME、清除 NO_COLOR、使用 caffeinate 的环境下执行 `bun run check`，退出 0：**1655 pass、0 fail、8615 assertions、127 files，194.92s**。oxfmt、oxlint、TypeScript project build、knip 均通过。日志：[最终完整检查](/tmp/neant-slash-final-check.log)。

[双轴审查](review.md)：Standards 与 Spec 各发现并解决 1 项，原审查代理分别复核，均无剩余问题。修复包括压缩中 `/exit` 的取消收尾，以及 Core 新增可见错误的错误码与双语文案。最终验证还通过受控公共 hook / store 入口复现并修正两处测试就绪时序，五轮聚焦重复验证均通过，生产行为保持规格定义。

主分支合并兼容了后续子代理恢复、只读观察与回退提示：保留子 Run 状态及关闭完成边界；子 Run 持久化共用序列化存储；会话列表使用只读打开，损坏记录拒绝修复并输出双语错误；侧问移除未完成工具协议对，同时保留未知结果说明。两轴再次独立复核，无剩余问题。

合并提交代码的最终完整检查退出 0：**1713 pass、0 fail、9060 assertions、134 files，209.96s**；oxfmt、oxlint、TypeScript project build、knip 全部通过。日志：[主分支最终完整检查](/tmp/neant-slash-main-final-check.log)。验证采用上述隔离环境。

八个实现工作树与一个审查修复工作树均已通过 managed worktree 工具归档，九个目录均已移除；全部本任务临时分支（包括 `codex/slash-commands-integration`）已删除。当前本地 Markdown tracker 已完成关闭。
