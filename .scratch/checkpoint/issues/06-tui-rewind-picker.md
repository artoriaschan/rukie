# 06: TUI Rewind 面板（照 dsh-TUI）

**What to build:** TUI 中，session 空闲且输入框为空时双击 Esc 打开 Rewind 面板，界面、样式、交互照 dsh-TUI `RewindPicker`。面板列出本 session 的 user prompt（新到旧，单行预览，附改动文件数），选中后在确认步选"回代码 + 对话 / 只回对话 / 只回代码"，并列出将还原、将删除的文件和 bash 提示。完成后显示 notice；回对话时 prompt 填回输入框。细节见 [spec](../spec.md) Implementation Decisions 的 TUI 条目。

**Blocked by:** 03

**Status:** resolved

- [x] 首次 Esc 显示 "Press Esc again to rewind"，3000ms 内第二次打开；超时重新计窗
- [x] 输入非空时 Esc 清空；run 中 Esc 中止；有挂起交互时不触发；无 prompt 时只提示 "Nothing to rewind yet"
- [x] 新增 app 组件 `rewind-picker`（③层 props only），停靠输入框下方，permission 色 `Divider` 顶线、标题 / 副标题 / 底部提示
- [x] 列表：80 字符截断、首行 "last message"、"N files changed"、`❯` 选中、↑/↓ 循环、滚动箭头、行数随空间
- [x] 确认步：三选项（无文件改动时只有回对话）、文件清单折叠 "+N more"、bash 提示、Enter 执行、Esc 回列表
- [x] 完成：关闭面板；回对话填回 prompt 并提示 "Rewound — edit and press Enter to resend"；只回代码提示 "Restored N files"；失败显示错误 notice
- [x] 文案进 neant-tui i18n 字典
- [x] 屏幕测试（`tests/screens/chat/rewind.test.ts`）覆盖以上

## Answer

已交付输入框下方的 props-only `rewind-picker`；screen 持有双 Esc 窗口、列表 / 确认焦点与 Session 调用。permission 色 Divider、标题 / dim 副标题、`❯` 焦点、循环方向键、鼠标仅移焦点、按真实行成本窗口化与两步 Esc 行为均参照 dsh-TUI 实际组件。确认覆盖三模式，从目标起每路径最早记录的还原 / 删除清单，固定文件区域保持切换焦点时布局稳定；窄屏保留完整 bash 提示和独立的 `+N more` 计数。所有面板与 notice 文案进入 en / zh 字典。

回对话订阅 `conversation_rewound`，使用与初始 / resume 相同的 Session → ViewState 投影，立即重放新分支的消息及 Tool State，清空旧 assistant / tools / todo / Plan / child 与使用量显示。清除事件的 `undefined` 安全处理。回填 prompt 重挂输入组件，让光标处于末尾；真实公开屏幕测试验证追加改写与重新发送的模型上下文。只回代码不改消息；失败关闭面板并显示原错误，文件和对话保留。

- 实现提交：`1c72b9e`；审查修正与输入历史测试收尾同步修正：`227ef4e`。
- 公开 seam：`start` + headless terminal（真实 `createSession` / resume 和受控模型边界），新增 `tests/screens/chat/rewind.test.ts`。覆盖 40×12、60 / 80 列、CJK 显示列 / 长文件名、滚动箭头、鼠标、resize、三模式磁盘和对话结果、缺失备份、Todo / child 共存、permission / question / plan 优先级、回填改写与新分支继续运行。
- focused rewind + input-history：28 pass / 0 fail，152 expect，2 files，9.17s；`bunx tsc -b` exit 0。Spec 独立复跑 rewind 23 pass / 0 fail，148 expect，以及 input-history 5 pass / 0 fail。
- 最终固定源码树 `227ef4e` 完整检查：全新隔离 HOME `/tmp/neant-checkpoint-06-final-home`，`env -u NO_COLOR caffeinate -is bun run check` exit 0，1536 pass / 0 fail，7994 expect，114 files，176.20s；format、lint、typecheck、knip 全通过。日志 `/tmp/neant-checkpoint-06-final-check.log`。
- code-review 固定点 `7d9bc6c07ca16207a8542d4b8051a179cca01ac5`，独立 Standards / Spec 两轴：最终均 0 findings。Standards 初次 P3 重复初始化以共用 `createViewState` 解决；Spec 初次 P2 长路径吞掉 `+N more` 经公开屏幕回归先 red 再修成 green，独立复核通过。输入历史测试同步修正也经两轴专项复核，均 0 findings。

## Comments

2026-10-05：TDD 的首个双 Esc 空 Session 测试先失败，最小实现后通过；真实回填改写测试揭露光标停留在开头，修复后验证末尾追加与 Enter 重发。审查补充 40×12 长 CJK 文件路径回归，先验证计数确实消失，再保留尾部计数列修复。

首次固定树完整检查为 1534 pass / 1 fail：既有 input-history 测试仅用 spinner 消失等待收尾，误认 Run 空闲。诊断在 80 轮中复现 1 次；临时边界探针在 240 轮中复现 2 次，失败 Ctrl+C 时 `isRunning` 与视图 `running` 均为 true，editor 的 current / value 一致。日志顺序确认新 rewind 时钟测试在该失败之后执行，排除时钟污染。改用本次唯一答案可见且底部中断提示消失的公开屏幕完成条件，产品输入行为保持一致；修正后 160 轮 stress 为 160 pass / 0 fail，40.56s。探针和临时压力测试文件均已移除。
