# 06: TUI Rewind 面板（照 dsh-TUI）

**What to build:** TUI 中，session 空闲且输入框为空时双击 Esc 打开 Rewind 面板，界面、样式、交互照 dsh-TUI `RewindPicker`。面板列出本 session 的 user prompt（新到旧，单行预览，附改动文件数），选中后在确认步选"回代码 + 对话 / 只回对话 / 只回代码"，并列出将还原、将删除的文件和 bash 提示。完成后显示 notice；回对话时 prompt 填回输入框。细节见 [spec](../spec.md) Implementation Decisions 的 TUI 条目。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 首次 Esc 显示 "Press Esc again to rewind"，3000ms 内第二次打开；超时重新计窗
- [ ] 输入非空时 Esc 清空；run 中 Esc 中止；有挂起交互时不触发；无 prompt 时只提示 "Nothing to rewind yet"
- [ ] 新增 app 组件 `rewind-picker`（③层 props only），停靠输入框下方，permission 色 `Divider` 顶线、标题 / 副标题 / 底部提示
- [ ] 列表：80 字符截断、首行 "last message"、"N files changed"、`❯` 选中、↑/↓ 循环、滚动箭头、行数随空间
- [ ] 确认步：三选项（无文件改动时只有回对话）、文件清单折叠 "+N more"、bash 提示、Enter 执行、Esc 回列表
- [ ] 完成：关闭面板；回对话填回 prompt 并提示 "Rewound — edit and press Enter to resend"；只回代码提示 "Restored N files"；失败显示错误 notice
- [ ] 文案进 neant-tui i18n 字典
- [ ] 屏幕测试（`tests/screens/chat/rewind.test.ts`）覆盖以上
