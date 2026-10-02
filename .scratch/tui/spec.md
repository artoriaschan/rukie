Status: ready-for-agent

# Spec: TUI（`@neant/tui` 渲染器 + `neant` 交互式 frontend）

全屏布局、滚动和退出行为已按 [全屏 TUI 访谈](../fullscreen-tui/interview.md) 的 Q1–Q19 更新，决策见 [ADR-0006](../../docs/adr/0006-fullscreen-tui.md)。

## Problem Statement

Headless CLI 已经能用了，但每次只能处理一条 prompt，处理完进程就退出。要接着聊只能手动带 `--resume`，看不到工具在做什么，模型要调用写文件或执行命令这类工具时，也没法当场问我同不同意，只能事先用 `--allow-tools` 放开，或者干脆 `--yolo`。我想在终端里像用 Claude Code 那样用 Neant：在一个 session 里连续对话，回复和工具调用实时显示，需要授权的时候当场问我。以后桌面端也得把 `ask` 交给用户确认，这个能力最好现在就在 Agent Core 里做好。

## Solution

新增两个包：

- `@neant/tui`：和 agent 无关的终端渲染器。管线是 React 协调树 → Yoga 布局 → 内存里的 cell 网格 → 前后帧差分 → ANSI 写出（ADR-0005）。对外提供少量通用原语。
- `@neant/neant-tui`（命令 `neant`）：在进程内创建 session，把 run 的事件流渲染成对话界面。

`neant` 在 alternate screen 全屏渲染：Logo、启动信息、完成消息与活动回复都在滚动主体；工作状态、输入或审批、状态栏固定底部。退出恢复启动前的终端内容和光标，不残留本次 TUI 内容，不删除 Session。原生选择与复制通过终端自身的选择手势使用。

Agent Core 新增两个能力：前端可以接管 `ask` 判定；session 暴露只读的消息列表，用于 resume 时回显。Headless CLI 的行为不变，它已经改名为 `neant-cli`，`neant` 这个命令名留给 TUI。

## User Stories

1. 作为开发者，我想在项目目录里运行 `neant` 进入交互界面，这样不用每次重新启动进程就能连续对话。
2. 作为开发者，我想运行 `neant "<prompt>"` 时把这个 prompt 作为第一条消息直接发出，这样能少按一次回车。
3. 作为开发者，我想在不带参数启动时看到一个空的输入框，这样能马上开始输入。
4. 作为开发者，我想看到助手的回复按 token 实时显示出来，这样不用干等整轮结束。
5. 作为开发者，我想看到每个工具调用的名字和参数摘要，这样知道 agent 正在做什么。
6. 作为开发者，我想在工具运行时看到 spinner，这样知道它没卡住。
7. 作为开发者，我想在工具结束后看到它折叠成一行，用 ✓ 或 ✗ 表示结果，这样界面不会被工具输出淹没。
8. 作为开发者，我想在工具出错时看到错误的前几行，这样不用翻日志就知道哪里出了问题。
9. 作为开发者，我想在需要授权的工具被调用时看到确认对话框，这样能当场决定，不用事先猜要放开哪些工具。
10. 作为开发者，我想在对话框里选“允许一次”，这样只放行这一次调用。
11. 作为开发者，我想选“本 session 内一直允许这个工具”，这样同一个工具不会被反复询问。
12. 作为开发者，我想选“拒绝”后让模型收到“未获授权”的结果并继续工作，这样 run 不会因为我拒绝就中断。
13. 作为开发者，我想“一直允许”只对当前 session 有效、不写进 settings，这样不会在不知情的情况下永久放开权限。
14. 作为开发者，我想让 `--allow-tools`、settings 里的 `allowTools` 和 `--yolo` 在 TUI 里同样生效，这样已经放开的工具不会再弹出确认。
15. 作为开发者，我想让 TUI 支持 `--model`、`--thinking`、`--resume`、`--trust-project-mcp`，用法和 `neant-cli` 一致，这样两边不用记两套参数。
16. 作为开发者，我想在 `--resume` 时看到之前的对话（用户消息、助手回复、工具调用摘要），这样知道自己接着哪里继续。
17. 作为开发者，我想在 run 进行中按 Esc 或 Ctrl+C 中断，这样 agent 走偏时能马上叫停，而已经产生的消息不会丢。
18. 作为开发者，我想在空闲时按 Ctrl+C 清空输入框，这样能快速放弃写到一半的内容。
19. 作为开发者，我想在输入框为空时 1 秒内连按两次 Ctrl+C 退出，这样不会误按一下就退出了。
20. 作为开发者，我想在输入框为空时按 Ctrl+D 直接退出，这样符合终端的习惯。
21. 作为开发者，我想在 run 进行中也能编辑输入框，但按 Enter 不会提交，这样能提前写好下一条消息。
22. 作为开发者，我想用 Shift+Enter 或在行尾输入 `\` 再回车来换行，这样能写多行 prompt。
23. 作为开发者，我想把一大段文字粘贴进输入框后它保持原样、不会被当成多次提交，这样能直接粘贴代码和日志。
24. 作为开发者，我想正常输入和显示中文等宽字符，光标位置也不错位，这样能用中文对话。
25. 作为开发者，我想在调整终端窗口大小后界面跟着重新排版，不留残影，这样随时可以拉宽窗口看长内容。
26. 作为开发者，我想通过滚轮、PageUp/PageDown 浏览消息主体，浏览时新输出不抢占位置，Ctrl+End 或提交新消息恢复底部跟随，并能使用终端原生选择复制。
27. 作为开发者，我想让快速流式输出时界面不闪烁、CPU 占用也不高，这样长回复也能流畅地看完。
28. 作为开发者，我想在 compaction 发生或 MCP server 连接失败时看到一行灰色提示，这样知道上下文被压缩了，或者某些工具不可用。
29. 作为开发者，我想在底部状态栏看到当前模型名和本次 run 的 token 数，这样心里对成本有数。
30. 作为开发者，我想在 settings 有问题或缺少模型配置时看到和 `neant-cli` 一样的报错，并且以非 0 退出码退出，这样排查方式一致。
31. 作为开发者，我想在退出时恢复启动前的终端画面、光标和模式，TUI 内容不残留，这样退出后 shell 还能正常用。
32. 作为开发者，我想让 TUI 的 session 和 `neant-cli` 写进同一个 Session Store，这样两边可以互相 `--resume`。
33. 作为开发者，我想让 `neant-cli` 遇到需要授权的工具时还是直接拒绝，这样 headless 脚本的行为不受影响。
34. 作为以后开发桌面端的开发者，我想让 Agent Core 通过回调把 `ask` 交给 frontend 决定，这样桌面端可以复用同一个口子。
35. 作为 `@neant/tui` 的使用者，我想用 `Box`、`Text` 和 flex 布局来写终端界面，这样写界面的方式和写 React 网页差不多。
36. 作为 `@neant/tui` 的使用者，我想用 `Static` 把内容一次性写进 scrollback，之后它不再参与重画，这样长对话的渲染成本不会越来越高。
37. 作为 `@neant/tui` 的使用者，我想用 `useInput` 拿到解析好的按键和粘贴事件，这样不用自己处理转义序列。
38. 作为 `@neant/tui` 的使用者，我想用 `useTerminalSize` 拿到当前的列数和行数，并在 resize 时触发重新渲染，这样界面能自适应窗口。
39. 作为 `@neant/tui` 的使用者，我想直接使用现成的 `TextInput` 和 `Spinner`，这样不用每个 app 各写一遍。
40. 作为维护者，我想让 `@neant/tui` 不依赖 `@neant/agent`，这样渲染器可以单独测试，也能单独演进。

## Implementation Decisions

### Agent Core（`@neant/agent`）

- **权限判定**：`decidePermission` 目前只会返回 `allow` 或 `deny`。改成凡是不在只读集合、`allowTools` 里也没有、又没开 yolo 的工具，都返回 `ask`。现在没有任何规则会产生真正的 `deny`，这个返回值留给以后的规则引擎。
- **`SessionOptions` 新增 `onPermissionAsk`**：签名是 `(request: { toolCallId, toolName, args, signal }) => Promise<"allow" | "deny">`。
  - 判定为 `ask` 时：传了这个回调就 await 它；没传就按 `deny` 处理。Headless CLI 不传，所以行为不变。
  - 回调返回 `deny` 时，和现在一样：阻止调用、给模型返回“该工具未获授权”、发出 `permission_denied` 事件。
  - run 被 abort 时，正在等待的回调视为 `deny`。frontend 可以根据 `signal` 关掉对话框。
  - “本 session 内一直允许”由 frontend 自己用内存集合记住，下次直接返回 `allow`。Agent Core 不管这个状态，不需要新增 API。
- **`Session` 新增只读的 `messages`**：返回内存中已经还原的 context 消息，只读，不重新读文件。TUI 用它在 resume 时回显旧对话。
- 导出的公开类型补上 `onPermissionAsk` 的请求类型。

### 渲染器（`@neant/tui`，新包）

- 不依赖 `@neant/agent`，依赖 `react` 19.3.0 和 `react-reconciler` 0.34.0（版本要记入 `docs/tech-stack.md`）。
- **管线**（ADR-0005）：
  - reconciler 的 host config 维护宿主节点树；
  - 每个宿主节点挂一个 Yoga 节点，文本节点用 measure 函数报尺寸；
  - 布局算完后，把节点树画进 cell 网格，每个 cell 存字符、显示宽度（中文等宽字符占两格，第二格是占位）和样式；
  - 和上一帧的网格逐 cell 比较，只把变化的部分转成光标移动和 SGR 序列写出。
- **Yoga**：拷贝 dsh-TUI 的纯 TS 移植，作为包内的一个独立模块。文件头注明来源和 commit，来源风险见 ADR-0005。只通过布局模块使用它，不对外导出。
- **文本宽度和换行**：用 `Bun.stringWidth` 和 `Bun.wrapAnsi`，不额外引入依赖。
- **Inline 模式**（通用渲染器保留，`neant` 不提供用户切换选项）：
  - 活动区画在当前光标往下的区域。
  - `Static` 里新增的子项按顺序写在活动区上方，随后被推进 scrollback，之后不再重画，也不参与差分。
  - 活动区的高度超过屏幕时，只画最底下那部分。
  - resize 后清掉活动区，完整重画一次（scrollback 里已有的内容交给终端自己重排）。
- **全屏模式**（`render(..., { fullscreen: true })`）：
  - 进入 alternate screen，以绝对光标位置绘制整个视口；退出和可处理异常恢复原画面、raw mode、光标、粘贴及鼠标上报。
  - `ScrollBox` 独立测量内容、裁剪可见区域；底部跟随，上滚暂停，回到底部恢复；宽度重排按可见文本锚点恢复位置。
  - 已展示条目不截断，只绘制视口行并复用文本测量；鼠标仅解析 SGR 滚轮，不提供应用内拖选。
- **帧调度**：React commit 时标记“脏”，合并到每 16ms 最多一帧。
- **输入**：开启 raw mode，解析按键（方向键、Ctrl 组合键、Esc、Shift+Enter 等常见编码），开启 bracketed paste，粘贴的内容整段作为一个事件交出去。退出时（包括异常退出）恢复 raw mode、光标、bracketed paste 的状态。
- **对外 API**：
  - `render(element, { stdin, stdout, fullscreen? })`：返回 `{ unmount, waitUntilExit }`；
  - `Box`：flex 布局，支持 padding、margin、gap 和边框；
  - `Text`：颜色、粗体、暗色、换行或截断；
  - `Static`（用于 inline）；
  - `ScrollBox`、`ScrollHandle`（`scrollBy`、`scrollToBottom`、`getSnapshot`）；
  - `useInput`；
  - `useTerminalSize`；
  - `TextInput`：多行，受控，支持方向键与 Home/End，`maxLines` 限制可见高度并保持光标可见；支持文字样式与反色方块光标，`ThemedTextInput` 解析主题颜色；
  - `Spinner`。
- 不做：应用内文本选择与自动复制、鼠标拖选、超链接、图片。

### TUI frontend（`@neant/neant-tui`，新 app，命令 `neant`）

- **入口**：写成 `main(argv, io)`，和 Headless CLI 一样。`io` 里有 `stdin`、`stdout`、`stderr`，以及 session 覆盖项（测试时注入假 `streamFn` 和 `model`）。
- **参数**：自己写一份 `parseArgs`，不和 `neant-cli` 共享代码。
  - 支持：`--model`、`--thinking`、`--resume`、`--allow-tools`（规则和 `neant-cli` 一样，可以带多个值）、`--yolo`、`--trust-project-mcp`，以及可选的一个位置参数作为第一条 prompt。
  - 参数错误时退出码为 2。
  - settings 有问题或缺少模型时，按 `neant-cli` 的文案打印到 stderr，以 1 退出，这时还没进入渲染。
- **启动**：参数解析后先验证 stdin/stdout 为 TTY 且 TERM 不是 dumb；不满足时以 1 退出，提示使用 neant-cli，不创建 Session 或请求模型。随后调用 `loadSettings`、`createSession` 并进入全屏。resume 从 `session.messages` 回放现有压缩后上下文，不新增完整 Transcript 展示接口。
- **视图状态**：由 `SessionEvent` 驱动的 reducer 维护 `{ 已完成的条目, 流式中的助手文本, 正在跑的工具调用, 待确认的权限请求, run 状态, 本次 run 的 usage }`。
  - 条目类型有：用户消息、助手文本、工具调用、系统提示（compaction 和 MCP 报错）。
  - 完成条目保留在消息主体中，当前运行中已展示的旧条目不会因 compaction 被移除。
- **显示**：
  - 助手文本按原样显示。
  - 工具调用显示“名字和参数摘要”，摘要截断到一行。跑的时候带 Spinner，结束后显示 ✓ 或 ✗；出错时显示错误的前几行。
  - System reminder 不显示。
  - 状态栏显示模型名，以及本次 run 的 input 和 output token 数。
- **布局**：输入框样式同步 dsh-TUI：圆角上下边框、无左右竖线、上方一行留白，主题正文色、方块光标，运行时仅 `❯` 提示符变暗。输入区包含留白与上下边框，最多 6 行且不超过屏高三分之一，长草稿内部滚动；审批替换输入，最多半屏，详情独立滚动、选项与提示固定。小于 40 列或 12 行时暂停编辑和审批决定，保留中断/退出，Run 不自动取消，草稿不丢失。
- **权限对话框**：`onPermissionAsk` 先检查“本 session 一直允许”的集合，命中就直接返回 `allow`；否则把请求放进视图状态，渲染对话框，等用户选择。
  - 三个选项：允许一次、本 session 内一直允许这个工具、拒绝。
  - 默认滚动消息主体，Tab 切换消息区/详情的翻页焦点；滚轮作用于指针所在区，Ctrl+End 始终回到主体底部。结束后恢复草稿与输入焦点，不自动提交。
  - 方向键或数字键选择，Enter 确认，Esc 等于拒绝。
- **滚动**：PageUp/PageDown 翻一视口减一行，滚轮默认 3 行；暂停跟随时显示回到底部提示，新输出（含已有流式回复的增长）更新提示。提交新消息恢复跟随，编辑草稿不改变阅读位置。
- **按键**：
  - run 进行中：Esc 或 Ctrl+C 触发这次 run 的 AbortController。
  - 空闲时：Ctrl+C 清空输入框；输入框为空时，1 秒内第二次 Ctrl+C 退出；输入框为空时按 Ctrl+D 退出。
  - run 进行中可以编辑输入框，但 Enter 不提交。
  - Shift+Enter 或行尾的 `\` 加回车换行。
- **退出**：卸载渲染器，恢复原终端画面和模式，正常退出码为 0；致命错误在恢复后输出 stderr。

### 仓库

- 目录结构遵守 CLAUDE.md：`packages/tui` 下每个概念一个目录，各自通过 `index.ts` 暴露 API；新包要加进根 `tsconfig.json` 的 references，CLAUDE.md 的目录说明也要补上这两个包。
- 新增的依赖版本精确锁定，并写进 `docs/tech-stack.md`：`react`、`react-reconciler`、`@xterm/headless`（只作为 devDependency），以及 `@types/react`。

## Testing Decisions

- 好的测试只验证外部可观察的行为：屏幕上显示的文字、光标位置、scrollback 的内容、发出的事件、模型收到的上下文、退出码。不测试 reducer、按键解析、cell 网格这些内部实现，也不 mock 模块。
- 所有测试都用 `bun:test`（ADR-0004），放在各包的 `tests/` 下，测试辅助代码放在 `tests/helpers/`。
- **Seam 1：Agent Core 的公开接口**（沿用 headless-agent 的做法）
  - 注入假 `streamFn`，`cwd` 和 `homeDir` 指向临时目录。
  - 新增覆盖：
    - 回调返回 `allow` 时工具执行，返回 `deny` 时发出 `permission_denied`，模型收到“未获授权”；
    - 不传回调时按 deny 处理；
    - 已经放开的工具不会触发回调；
    - abort 时等待中的回调按 deny 处理；
    - resume 之后 `messages` 包含之前的对话。
  - 参考：`packages/agent/tests/` 现有的 session 测试，以及 `tests/helpers` 里的 fake-model 和 temp-dirs。
- **Seam 2：假终端**（TUI 唯一的 seam）
  - 测试辅助代码提供假的 stdin（可以写入按键和粘贴的字节）、假的 stdout（固定 `columns` 和 `rows`，可以触发 resize），并把 stdout 收到的所有字节喂给 `@xterm/headless`，从中读出屏幕、scrollback 和光标位置。
  - `@neant/tui` 用这个 seam 测 `render(<测试组件>, { stdin, stdout })`，覆盖：
    - Box 和 Text 的布局；
    - 中文等宽字符的列对齐；
    - 多帧之后的屏幕和从头完整渲染一次的结果一致（验证差分正确）；
    - `Static` 的内容进入 scrollback，只出现一次；
    - resize 之后没有残影，浏览时保持文本阅读锚点；
    - 全屏占满视口、固定底部、独立主体滚动、跟随与暂停、1000 条消息可回看；
    - 退出、可处理信号和绘制异常恢复原画面与光标，关闭鼠标上报；
    - 有限高度输入保留完整草稿并保持编辑光标可见；
    - 退出后终端状态已经恢复；
    - 粘贴的内容作为一个整体到达。
  - `@neant/neant-tui` 用同一个 seam 驱动 `main(argv, io)`，`io` 里注入假 `streamFn`，覆盖：
    - 输入 prompt 后看到流式回复；
    - 工具调用折叠后的那一行；
    - 权限对话框的三个选项分别产生的效果（包括“一直允许”之后不再询问）；
    - Esc 中断 run；
    - 两次 Ctrl+C 退出；
    - `--resume` 回显旧对话；
    - 参数错误时退出码为 2；
    - 非 TTY/TERM=dumb 拒绝启动、全屏退出清理、40×12 与极小窗口、审批详情滚动与焦点及草稿恢复。
  - 拷进来的 Yoga 不单独测试，通过 Box 的布局测试间接覆盖。
  - 参考：`apps/neant-cli/tests/main.test.ts` 的进程内 `main(argv, io)` 写法；dsh-TUI 用 `@xterm/headless` 还原屏幕的验证脚本（只参考思路）。
- 自动回归使用上述两个 seam，不依赖截图。另以真实 PTY 验证启动、滚轮/翻页和退出；真实终端原生复制手势的 GUI 验收结果与工具限制记录在全屏实施记录中。

## Out of Scope

- markdown 渲染、代码高亮、diff 视图。
- `/` 弹出 skill 补全，以及历史记录搜索。
- run 进行中把消息排队，等结束后自动发送。
- 把“一直允许”写进 settings 的 `allowTools`。
- 权限规则引擎（真正的 `deny` 规则）。
- 应用内文本选择、自动复制、鼠标拖选、超链接、图片。
- 主题和颜色配置、国际化。
- 粘贴图片。
- TUI 通过 server 和 WS 连接 Agent Core（现在在进程内直接调用）。
- `neant` 和 `neant-cli` 合并成一个入口。
- 编译成单文件可执行程序和对外分发。

## Further Notes

- `neant` 这个命令名的含义变了：以前是 headless，现在是 TUI。headless 改用 `neant-cli`，它的参数和行为都没变。
- Yoga 移植的来源风险已经记在 ADR-0005。如果以后要对外分发，先替换掉它，现有的 Box 布局测试会成为替换后的回归基线。
- dsh-TUI 的 `src/ink/` 只作为设计参考（特别是 `screen.ts` 的 cell 网格、`log-update.ts` 的 inline scrollback 处理、`parse-keypress.ts` 的按键编码表）。除了 Yoga 之外不拷贝代码。
