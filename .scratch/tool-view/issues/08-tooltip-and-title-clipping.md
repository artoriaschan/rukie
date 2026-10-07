# 08: Tooltip 与标题裁剪

**What to build:** 过长的参数和多行命令在头部被裁剪，用户悬停被裁剪的标题时出现 tooltip 看全内容与起止时间。见 [spec](../spec.md) 的「TUI 工具卡」Tooltip 部分。

Blocked by: 02

Status: resolved

- [x] 设计系统新增 Tooltip 组件：悬停 600 ms 显示，按可用空间定位，小终端裁剪
- [x] generic 标题 args 超 480 字符裁剪
- [x] 用户设置新增 `foldTerminalCommand`（默认 `true`）；开启时多行命令折叠为首行 + `+N lines`
- [x] 仅当头部确有隐藏内容（折叠脚本、args 裁剪、单行标题超宽）时出现 tooltip，内容为完整标题 + 起止时刻 + 退出码 / 信号，不含耗时
- [x] TUI e2e 覆盖出现与不出现两种情况及小终端

## Answer

- 设计系统 `TooltipProvider` 在终端根节点管理一个延迟浮层，`Tooltip` 包裹确有隐藏内容的标题；悬停 600ms 后才解析最新完整文本。位置采用最后绘制的 mouse entry viewport 坐标，按上 / 下可用高度选边，grapheme cell 宽度换行并裁剪；小于 3 列或 3 行不显示。
- renderer `Box.onMouseEnter({ x, y })` 提供进入时终端坐标，原无参 callback 保持兼容；离开、卸载、按键、点击、滚轮、失焦及 resize 清除 pending / visible tooltip。Chat 在 modal / Interaction / 页面变化时调用 `useDismissTooltip()`。
- generic 参数超 480 字符显示省略号；用户设置 `foldTerminalCommand` 默认 true，多行前台脚本折叠为首行 + `+N lines`（中英文同步）。false 保留所有标题行，设置传到主聊天与子代理 Tools 页。保留 05 的 `diffLayout` 设置与 provider。
- 只在 args 裁剪、脚本折叠或标题宽度裁剪时提供 tooltip，包含完整标题及可用的开始 / 结束时刻、退出码、信号；无耗时重复。
- red→green：公开 `startWithClock` + headless terminal 首先复现缺少 `+1 lines`；验证 599ms 不显示 / 600ms 出现、完整标题无 tooltip、移出取消、用户设置 false、40×12 Unicode 裁剪 / 失焦 / 2×2 resize、520列 args480预算、失败命令 `Exit code: 143` 与 `Signal: SIGTERM`。6 个新测试 67–152ms。
- 最终相关测试：`env -u NO_COLOR bun test` 的 `tool-tooltip`、`tool-syntax`、`tool-view`、`split-diff`、`subagent-views`、renderer `hover` 共 38 通过、177 断言、4.97s；`bunx --no -- tsc -b`、Oxlint、Knip 通过。曾在同步 05 后缺少本地 diff 安装，通过 `bun install --frozen-lockfile` 恢复，随后全部通过。README API 与用户设置说明已同步。
- 已合入 integration `085cff3`，源码 `c19ad75`，整合 `57341bf`；完整 aggregate 由 integration 最终统一执行。
