# 全屏 TUI 实施记录

Status: implemented; automated and PTY validation passed; native-copy GUI validation unavailable

设计依据：[访谈 Q1–Q19](interview.md)，用户于 2026-10-02 回复“确认设计，开始实施”。起点 commit：`a8fc5eb92e0d8d404a87cc7c20d687741c20b815`。

## 交付

- `neant` 使用 alternate screen 和整个终端视口，消息主体独立滚动，底部固定输入或审批、工作状态和状态栏。
- 通用渲染器新增 ScrollBox、滚动控制与布局裁剪；保留 inline 渲染器兼容能力。文字测量复用，可见行绘制；当前显示消息不截断。
- 滚轮、翻页、底部跟随、暂停提示、主动提交回底部、宽度重排文本锚点；多行输入内部滚动，审批参数滚动及焦点切换。
- 小窗口暂停编辑和审批，草稿与 Run 保留；非交互终端提前拒绝启动。
- 正常退出、可处理信号和绘制异常恢复原画面及模式；致命错误恢复后写 stderr。

## 已完成的验证

- 公开 renderer IO：全屏视口/原画面及光标恢复、独立滚动、宽度重排锚点、1000 条消息保留、信号/绘制异常清理。
- 公开 TextInput/main IO：有限高度草稿（预算包含分隔线）、中文与 grapheme 光标、上下方向键/Home/End、空行编辑、粘贴、resize。显式 columns 同时用于编辑与绘制，避免短草稿行尾光标错行。
- 真实 main(argv, io)：全屏流式输出、滚轮、暂停/恢复提示、40×12 审批滚动与固定选择、极小窗口暂停与恢复草稿；非 TTY stdin/stdout 和 TERM=dumb 的三个入口；活动 Run 绘制 IO 异常先恢复再输出 stderr 并中断 Run。
- 已有 main 回归：26 项通过，包括权限参数、Session resume、中断、连续输入、退出及配置错误。
- 最终 `rtk proxy env -u NO_COLOR bun run check` 于仓库根目录退出 0：oxfmt、oxlint、tsc -b、knip 及全仓测试均通过；297 pass / 0 fail，1799 assertions，37 files。输出记录 `/tmp/neant-fullscreen-check.log`。
- 真实 PTY（80×24）：临时验收脚本使用 fake model，无网络模型请求；通过真实 stdin 与 `/dev/tty` stdout 启动 main，发送 SGR wheel、PageUp、Ctrl+End、Ctrl+D。退出 0，`raw=false`，模型调用 1 次；输出包含鼠标模式关闭及 `?1049l` 画面恢复。RTK proxy 会管道化 stdout，所以通过 tty.WriteStream 打开同一 PTY，而非把管道伪装为 TTY。

## 双轴审查

Standards：初次发现 PromptInput 读取终端尺寸违背第③层 takes props only，以及 PermissionDialog 的无生产调用旧布局分支。已由 Chat 计算尺寸预算并传 props，删除旧分支，组件测试改为实际滚动详情布局；复核无剩余发现。

Spec：初次发现空行锚点丢失，以及输入区预算遗漏分隔线。已保留空行的逻辑字符位置，整个输入区含分隔线纳入预算，并补齐 80×24、40×12 和空行 resize 的公开接口回归；复核及最后列宽修复审查无剩余发现。

## dsh-TUI 输入框样式跟进

2026-10-02 用户要求“输入框样式同步 dsh-TUI”。基于本机安装的 `PromptInput.js`、`EffortInputBorder.js`、`EffortChargeGlyph.js` 与 `theme.js` 检查实际样式：圆角上下边框、无左右竖线、框前一行留白、`❯ ` 在运行时变暗、正文使用主题 text 色、反色方块光标。Neant 自行实现这些视觉规则；已有 promptBorder 配色一致。未引入参考产品的会话入口、展开编辑器或思考档位功能。

PromptInput 由 Chat 传入终端列宽与 working 状态，保持应用组件 takes props only；TextInput 接受文字样式与方块光标样式，ThemedTextInput 负责解析主题。输入区预算同时计入留白与上下边框，仍不超过 6 行和终端高度 1/3。公开 renderer/main IO 验证圆角与留白、自定义主题、中文与空行光标、失活时清理反色、运行时提示符变暗，以及 80×24 / 40×12 的高度预算和退出恢复。

`rtk proxy env -u NO_COLOR bun run check` 退出 0：格式、lint、类型检查、Knip 和全仓测试通过，299 pass / 0 fail，1818 assertions，38 files；日志 `/tmp/neant-prompt-style-check.log`。

以 `588317c` 为起点的双轴审查：Standards / Spec 均无发现。Spec 审查独立运行的 18 项定向测试通过。

## 验收限制（原生复制）

Computer Use 工具拒绝控制 `com.apple.Terminal`（工具返回“Computer Use is not allowed to use the app ... for safety reasons”）。因此真实 Terminal GUI 中的原生选择/复制手势未验证；PTY 验证不能证明此行为。应用未实现拖选或自动复制，仅开启点击/滚轮及 SGR 上报，选择绕过手势仍由终端程序提供。
