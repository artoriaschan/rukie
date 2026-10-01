# 03: 输入和 resize：useInput、useTerminalSize、TextInput

**What to build:** 组件能拿到解析好的按键和粘贴事件，能感知终端尺寸变化；有一个可以直接用的多行 `TextInput`。退出时终端恢复原状。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `useInput`：开启 raw mode，解析常见按键（字符、方向键、Enter、Shift+Enter、Backspace、Esc、Ctrl 组合键），开启 bracketed paste，一次粘贴作为一个整体事件交出
- [ ] `useTerminalSize` 返回列数和行数；resize 后清掉活动区并完整重画，假终端里没有残影
- [ ] `TextInput`：受控、多行，支持光标左右移动和删除；Shift+Enter 或行尾 `\` 加回车换行；Enter 交给使用方处理；中文输入时光标位置正确
- [ ] unmount 或进程异常退出时恢复 raw mode、光标可见性和 bracketed paste 状态
- [ ] 测试通过假 stdin 写入字节，在假终端里断言屏幕和光标
- [ ] `bun run check` 全绿
