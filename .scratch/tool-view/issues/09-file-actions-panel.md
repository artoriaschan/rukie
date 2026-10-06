# 09: 点击路径打开文件操作菜单

**What to build:** 用户点击卡片头部或 diff 路径行里的路径，弹出菜单选择打开文件、在文件管理器中显示或复制路径。见 [spec](../spec.md) 的「TUI 工具卡」FileActionsPanel 部分。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 路径段带下划线，点击停止冒泡，不切换卡片展开
- [ ] FileActionsPanel 三项：打开（host `openExternal`）、在文件管理器中显示（host 新增 reveal：macOS `open -R`，Linux 打开父目录）、复制路径
- [ ] 路径按 Session cwd 解析
- [ ] 菜单可用键盘与鼠标操作，Esc 关闭；小终端下完整显示或裁剪
- [ ] zh / en 文案
- [ ] TUI e2e 用 fake host 断言三项动作
