# 08: Tooltip 与标题裁剪

**What to build:** 过长的参数和多行命令在头部被裁剪，用户悬停被裁剪的标题时出现 tooltip 看全内容与起止时间。见 [spec](../spec.md) 的「TUI 工具卡」Tooltip 部分。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 设计系统新增 Tooltip 组件：悬停 600 ms 显示，按可用空间定位，小终端裁剪
- [ ] generic 标题 args 超 480 字符裁剪
- [ ] 用户设置新增 `foldTerminalCommand`（默认 `true`）；开启时多行命令折叠为首行 + `+N lines`
- [ ] 仅当头部确有隐藏内容（折叠脚本、args 裁剪、单行标题超宽）时出现 tooltip，内容为完整标题 + 起止时刻 + 退出码 / 信号，不含耗时
- [ ] TUI e2e 覆盖出现与不出现两种情况及小终端
