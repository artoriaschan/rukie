Status: needs-triage

# Spec: 桌面端 MVP

术语见 `CONTEXT.md` 的 Session、Run、Turn、Transcript、Interaction、Permission Mode。规划过程与各项决定见 [地图](map.md)。本稿目前只写主窗口布局，来源是 [09: 主界面粗稿](issues/09-prototype-main-window.md#answer)，与 [10: wire 协议消息清单](issues/10-wire-protocol-messages.md#answer) 冲突处按 10 改写；架构、wire 协议、sidecar 生命周期与实现工单在 13–20 结题后经 `/to-spec` 补写。

## 主窗口布局

原型保存在 `origin/prototype/desktop-main-window`（HEAD `ba40fd5d`），是布局与交互的原始资料：在 `prototypes/desktop-main-window/` 下执行 `npm install && npm run dev`，打开 `http://localhost:5199/`，可用 `?theme=light|dark&lang=zh|en&conn=connected|reconnecting|disconnected` 切换。原型是手写的 shadcn 风格组件，正式实现按 [AGENTS.md](../../AGENTS.md#ui-components) 选取组件（beUI 优先，shadcn 补位），外观按 [DESIGN.md](../../DESIGN.md)。

### 窗口外壳

- 窗口底色（`card`）承载通栏标题栏与左侧导航栏；侧栏与主区域合成一张 `background` 底的内容面板，只有左上角圆角，以一条 border 与窗口底色分界，侧栏与主区域之间一条竖线，与标题栏分隔线对齐。
- 标题栏左侧：交通灯占位、侧栏开关。右侧：类型图标（项目为文件夹，默认工作区为对话图标，tooltip 显示项目名或“对话”）、Session 标题、更多菜单、摘要开关。标题栏可拖动窗口，控件区不可拖动。
- 导航栏 MVP 只有“首页”（选中为实心图标加浅色圆角底块，标签在 tooltip 中）与底部头像。头像打开账户菜单，只有“使用情况”与“设置”。
- 窄窗口下侧栏浮在主区域之上，不改变侧栏内容。

### 侧栏

- 顶部是“新聊天”（⌘N），右侧为搜索按钮。搜索按钮或 ⌘K / Ctrl+K 打开居中命令浮层（侧栏收起时也可用）：空查询列出最近 8 个 Session，输入后按标题或项目名过滤；↑↓ 选择、Enter 打开、Esc 或点击遮罩关闭并把焦点还给打开者。
- 下面是四个可折叠分组：
  - 置顶：pinned Session。
  - 对话：默认工作区中不绑定项目目录的 Session。
  - 项目：按项目目录分组，文件夹可单独折叠，只用文件夹图标表示展开状态；hover 时出现项目更多菜单（置顶、编辑、归档聊天、移除项目）与“在该项目中新建会话”。
  - 最近：全部 Session，按更新时间倒序。
- 同一 Session 可同时出现在多个分组。按住 Ctrl 时显示 ⌃1–⌃9，编号按“最近”的顺序。
- 分组标题的折叠箭头与操作图标只在 hover 或获得焦点时出现，菜单打开期间保持可见。“最近”标题右侧有更多菜单（整理侧边栏 › 展开全部 / 收起全部；会话排序方式 › 按更新时间 / 按创建时间；显示：置顶、对话、项目勾选项；新建分区）与新会话按钮。排序同时决定“最近”顺序与 ⌃ 编号。
- 会话行只显示标题与状态：运行中显示转圈，等待权限确认显示 warning 色圆点；不显示时间。hover 时显示置顶 / 取消置顶。

### 主区域

- 新会话显示欢迎页加输入框。项目内标题为“你想让我们在 {项目} 中构建什么？”，默认工作区为“今天想聊点什么？”；标题中的项目名与输入框上方的位置条都能切换目标（项目或默认工作区）。首次发送即创建 Session 并切到它的对话视图。
- 历史会话显示对话加输入框，对话列居中，最大宽度 `max-w-3xl`。
- 用户消息为右对齐气泡。已完成的 Turn 折叠在“用时 {时间}”分隔线后，只显示最终回复，点击展开全部步骤；用户中止的 Turn 显示“你在 {时间} 后停止了”并保持展开；当前 Turn 完整展开，顶部显示“正在执行 · {时间}”，等待确认时显示“等待确认”。
- 左缘为 Turn 刻度（两个 Turn 以上才显示，窄窗口隐藏）：当前 Turn 刻度加长，点击跳转，hover 或聚焦显示该 Turn 的问题与最后回复预览。
- 会话摘要卡片由标题栏摘要开关切换，固定在对话区右上角，滚动时不动，不抢焦点，Esc 关闭。内容：变更文件（+/− 汇总，可展开文件列表）、分支、Todo 进度、子代理状态、来源。宽窗口打开时对话列让出位置，窄窗口覆盖全宽。

### 工具调用与权限审批

Pencil 视觉稿没有这两项的画板，以下方案来自原型。

- 工具调用为一行：工具图标、动作名（如“运行了命令”）、等宽字体的标题（命令或路径），运行中显示转圈，失败显示 danger 图标。默认折叠，点击展开输出或 diff；失败的调用直接展开输出。diff 行用 `diff-*` token。
- 待处理的权限 Interaction 停靠在输入框上方，不嵌在 Turn 中：标题“{工具} 需要你的确认”、等宽命令、原因，三个按钮“拒绝 Esc”“本会话内允许 A”“允许 ↵”，分别对应 Agent Core 的 `deny`、`allow-session`、`allow`；“允许”为主按钮并获得焦点。回复后卡片消失，Turn 内留一行结果（图标、回复、命令），Transcript 中可见这次决定。
- 断连或重连期间回复按钮禁用。重连订阅时 server 补发挂起的 Interaction，停靠卡重新出现；Interaction 被取消或被会话规则覆盖时卡片直接消失；回复已过期（`interaction_stale`）时丢弃。

### 输入框

- 一张圆角卡片：多行输入（Enter 发送，Shift+Enter 换行，输入法组合时不发送），左侧附件与权限模式菜单，右侧上下文用量环、模型选择、发送或停止。
- 权限模式菜单每项带说明（`ask` / `auto-review` / `full-access`），`full-access` 用 warning 色。
- 上下文用量环按已用比例填充，点击打开用量面板：系统 / 工具 / 消息分段条、开场上下文、压缩点，不显示估计费用。
- 模型列表 hover 或聚焦某行时在旁边显示该模型的详情：输入类型、上下文窗口、推理档次。档次取自 Agent Core `THINKING_LEVELS` 中该模型支持的子集，选档同时选中模型。
- Run 运行中 Enter 发送的是 Queued Input（[10](issues/10-wire-protocol-messages.md#answer)），不是 steer：它在当前 Run 停止调用工具后才放入对话，放入前可“立即发送”（steer）或撤回。输入为空时按钮为停止；停止会撤回全部 Queued Input，按排队顺序以空行合并后放回输入框草稿之前。原型中运行时直接 steer 的行为以此为准改写。

### 断开与重连

- 连接状态显示在输入框上方：重连中为转圈加“正在重新连接…”，已断开为断网图标加“连接已断开”与“重试”按钮；两种状态都说明 Run 仍在 sidecar 中继续，重连后补齐消息与待确认项。
- 断连期间不能发送，权限回复按钮禁用。

### 菜单与 tooltip

- 标题栏会话更多菜单：置顶（⌥⌘P）、复制 ›（Session ID、工作目录、Markdown）、打开方式 ›（在 Finder 中显示、在终端中打开）、归档（⇧⌘A）、永久删除（destructive）。原型中的“重命名”按 [10](issues/10-wire-protocol-messages.md#answer) 不做，已移除；Codex 的侧边聊天、分叉、计划任务、分享、新窗口在 MVP 中没有对应能力，不放入。
- 菜单用门户渲染，视口内翻转，支持方向键、Home、End、→ ←、Esc；指针打开时也能 Esc 关闭。
- 所有纯图标按钮都有 tooltip 与可访问名称；导航栏的 tooltip 显示在右侧。

### 相对 Pencil 与 registry 默认值的改写

- 颜色全部用 DESIGN.md 的 GitHub Light/Dark token，字号全部用 `text-ui-*`，文案全部进 zh/en 字典。
- Pencil 稿中的 Codex/ChatGPT 文案、模型倍率与估计费用不纳入。

### 待定

[03: MVP 范围与产品约束](issues/03-mvp-scope.md#answer) 定下的最小闭环是选项目、新建或恢复 Session、流式对话、工具调用展示与权限 Interaction，且 MVP 没有设置界面。[10](issues/10-wire-protocol-messages.md#answer) 的 MVP 命令已覆盖项目列举与添加、Session 置顶、模型与权限模式切换、带图片的发送。布局中以下入口在 10 中没有对应命令，或缺少原型，切实现工单前需逐项确认是做、只留布局还是移出 MVP：

- 账户菜单的“使用情况”与“设置”。
- Session 的归档、永久删除，项目的置顶、编辑、归档聊天、移除，以及“新建分区”。
- 会话摘要卡片的分支、变更文件与来源：需要 server 提供工作区信息。
- 附件按钮：10 只支持图片，文件附件是否保留入口。
- Queued Input 在对话或输入框中的展示，以及“立即发送”与撤回的入口：原型没有覆盖。
- Session 被其他进程（如 TUI）占用时（`session_busy`）的提示位置。
