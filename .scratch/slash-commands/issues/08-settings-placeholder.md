# 08: `/settings` 占位页

**What to build:** 用户在 TUI 输入 `/settings`，进入一个外观与交互复刻 dsh-TUI `Settings` 的全屏设置页；当前没有任何设置项，只显示空状态，Esc 回到对话。见 [spec](../spec.md) 的“TUI：选择器与界面”。

Blocked by: 01（命令框架与补全菜单）

Status: resolved

- [x] 新增 ④ 层设置屏幕：全屏，标题行带 `1/N` 计数；圆角分区卡片；`❯` 指针 + 选中底色；布尔 `[✓ ]` / `[  ]`、枚举 `‹ 值 ›` 的取值样式
- [x] 页脚：分隔线、通知行、按键提示（`**Enter** …  · Esc 退出`，加粗部分同 dsh-TUI）
- [x] 按键：↑↓ 移动、Enter、←→、Esc 关闭；字段模型留好接口，不实现写回
- [x] 当前不注册任何分区，显示一行暗色空状态文案（中英）
- [x] run 中被拒
- [x] TUI 测试覆盖空状态与 Esc 退出

## Answer

新增 `screens/settings` 全屏 ④ 层页面，保留布尔/枚举字段及分区接口、本地草稿切换、焦点计数、圆角卡片与滚动跟随；当前入口不注册任何分区，显示本地化暗色空状态。计数仅在存在字段时显示，与 dsh-TUI 一致，避免空页出现 `1/0`。页脚保留分隔线、通知空行和加粗 Enter 提示。

`/settings` 通过现有 idle-only 命令框架进入；页面拥有按键与本地状态，Esc 返回原对话。输入过滤同步依据视图，阻止与打开命令同批到达的文本变成隐藏草稿。不调用设置写回，也不产生模型请求。

验证：公开 `start()` 边界覆盖中英空状态、全屏对话隐藏与恢复、40×12、暗色空文案、加粗 Enter、通知空行、无设置文件变化、同批输入与 run 中拒绝。新套件 4 pass / 0 fail / 30 assertions；含 main、slash commands、model picker、question parity 的受影响回归 92 pass / 0 fail（新增页脚断言前 549 assertions）。`oxfmt --check`、`oxlint`、`tsc -b`、`knip` 均通过；整个 spec 的最终整合 full check 由交付阶段完成。
