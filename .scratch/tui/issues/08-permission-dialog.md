# 08: 权限确认对话框

**What to build:** 模型调用需要授权的工具时，TUI 弹出确认对话框，用户当场决定：允许一次、本 session 内一直允许这个工具、拒绝。拒绝后模型收到“未获授权”，run 继续。

**Blocked by:** 05, 06

**Status:** ready-for-agent

- [ ] TUI 传入 `onPermissionAsk`，对话框显示工具名和参数摘要，以及三个选项
- [ ] 方向键或数字键选择，Enter 确认，Esc 等于拒绝
- [ ] 选“允许一次”时只放行这一次；选“一直允许”后，同一个 session 里这个工具不再询问（只存在内存里，不写 settings）；选“拒绝”后模型收到“未获授权”，run 继续
- [ ] 对话框打开期间 run 被中断时，对话框关闭
- [ ] `--allow-tools`、settings 里的 `allowTools` 和 `--yolo` 放开的工具不弹对话框
- [ ] 测试走假终端 seam，覆盖三个选项分别产生的效果
- [ ] `bun run check` 全绿
