# 08: 权限确认对话框

**What to build:** 模型调用需要授权的工具时，TUI 弹出确认对话框，用户当场决定：允许一次、本 session 内一直允许这个工具、拒绝。拒绝后模型收到“未获授权”，run 继续。

**Blocked by:** 05, 06

**Status:** resolved

- [x] TUI 传入 `onPermissionAsk`，对话框显示工具名和参数摘要，以及三个选项
- [x] 方向键或数字键选择，Enter 确认，Esc 等于拒绝
- [x] 选“允许一次”时只放行这一次；选“一直允许”后，同一个 session 里这个工具不再询问（只存在内存里，不写 settings）；选“拒绝”后模型收到“未获授权”，run 继续
- [x] 对话框打开期间 run 被中断时，对话框关闭
- [x] `--allow-tools`、settings 里的 `allowTools` 和 `--yolo` 放开的工具不弹对话框
- [x] 测试走假终端 seam，覆盖三个选项分别产生的效果
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：新增 frontend 权限模块，按工具名在内存中记住当前 session 的授权；并发请求依次展示，“一直允许”同时放行已等待的同名工具。方向键或 1–3 选择，Enter 确认，Esc 拒绝当前请求，Ctrl+C 取消 run 并关闭全部待确认请求。
- 新增 13 条假终端测试，覆盖三种决定、一次授权后再次询问、跨 run 记忆及 session 隔离、settings 原文不变、配置和只读工具绕过、并发请求、草稿按键隔离以及取消后继续使用 session。
- code-review：Standards 无发现；Spec 发现多行草稿会挤掉权限对话框，已通过 red-green 回归修复：待确认时暂时隐藏编辑区，关闭后恢复原草稿。复审两轴均无剩余发现。
- 最终 `bun run check` 全通过：格式、lint、`tsc -b`、Knip，以及全仓库 219 tests / 1115 assertions。
