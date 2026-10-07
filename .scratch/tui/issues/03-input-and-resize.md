# 03: 输入和 resize：useInput、useTerminalSize、TextInput

**What to build:** 组件能拿到解析好的按键和粘贴事件，能感知终端尺寸变化；有一个可以直接用的多行 `TextInput`。退出时终端恢复原状。

Blocked by: 02

Status: resolved

- [x] `useInput`：开启 raw mode，解析常见按键（字符、方向键、Enter、Shift+Enter、Backspace、Esc、Ctrl 组合键），开启 bracketed paste，一次粘贴作为一个整体事件交出
- [x] `useTerminalSize` 返回列数和行数；resize 后清掉活动区并完整重画，假终端里没有残影
- [x] `TextInput`：受控、多行，支持光标左右移动和删除；Shift+Enter 或行尾 `\` 加回车换行；Enter 交给使用方处理；中文输入时光标位置正确
- [x] unmount 或进程异常退出时恢复 raw mode、光标可见性和 bracketed paste 状态
- [x] 测试通过假 stdin 写入字节，在假终端里断言屏幕和光标
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：新增公开 `useInput`、`useTerminalSize` 和受控多行 `TextInput`。输入流支持跨 chunk 的 UTF-8、方向键、Ctrl/Alt/Shift 修饰键和常见 Shift+Enter 编码；bracketed paste 的原始内容整段交付一次。TextInput 保留空格、规范化粘贴换行，支持左右移动、Backspace/Delete、两种换行方式与 `onSubmit`。
- resize 更新尺寸订阅并清除旧 viewport、完整重画，包括尺寸不变的 resize。光标与文本共用字素过滤和按显示列换行；中文、组合字符、emoji、窄窗口及满行后换行符前的光标都有假终端覆盖。外部替换受控值时，编辑位置向前对齐到完整字素边界，删除不会留下半个 emoji。
- unmount、process exit、uncaught exception、SIGINT/SIGTERM、初始化 IO 失败及后续绘制错误均恢复 raw mode、可见光标和 bracketed paste；清理输入/resize/进程监听器，恢复 stdin 流状态，并停止绘制。现有 frontend 信号处理器保留；后续绘制错误通过 `waitUntilExit` 拒绝交付。
- 在已约定的假终端 seam 按 red/green 添加回归。`bun run check` 全通过：格式、lint、`tsc -b`、Knip，以及全仓库 168 tests / 860 assertions；其中 TUI 30 tests。code-review 的 Standards 和 Spec 两轴发现的光标边界问题已修复，复审均无剩余发现。
