# 03: 主题与消息流样式

**What to build:** 在 `@neant/tui` 建立 ② 设计系统的主题部分，并让对话消息流用上它。主题为唯一的深色主题，10 个 token 及取值见 spec 的 ② 节表格；`ThemeProvider` / `useTheme` 提供主题，`ThemedText` / `ThemedBox` 的 `color` 接受 token 名；字形常量集中定义（`⏺`/`●` 按平台、`❯`、`⎿`、`•`、`✗`、`·•●•`）；`StatusIcon` 按 running / success / error 渲染。用户可见效果：user 消息 `❯` 前缀，assistant 消息 accent 色 `⏺` 前缀（流式中同样），工具调用显示状态点、结果与错误以 `⎿` 引出（错误 error 色，最多 3 行），notice 为 warning 色、run 错误为 error 色，状态栏 subtle 色且 Running 时状态词为 accent 色。

**Blocked by:** 01, 02

**Status:** resolved

- [x] 主题、Provider、Themed* 组件、字形常量、`StatusIcon` 从 `@neant/tui` 导出
- [x] `ThemedText` 把 token 解析成主题 hex 的测试（读回 cell 前景色）
- [x] neant 入口包上 `ThemeProvider`，③ 层消息、工具、notice、状态栏不再出现写死的颜色字面量或 `dimColor`
- [x] 现有测试中受字形变化影响的断言已更新，`bun run check` 全绿
- [x] 手动运行 `neant` 并触发一次工具调用，确认上述视觉

## Comments

- 2026-10-03 用户补充已实现：assistant 使用固定两列前缀区，长首词独立换行；忽略正文开头空行和纯空白片段，内部段落空行保留。user 对照本机安装的 dsh-TUI，使用加粗文字与两列悬挂缩进，并新增铺满消息区域的浅灰背景和适配浅底的深金色主题 token。Box 提供背景矩形绘制，ThemedBox 解析主题；未复制参考源码。
- 补充公开 render/headless terminal 回归：圆点与首词同排、空白片段不出圆点、user 多行/CJK/emoji/缩进与整块底色、主题覆盖/resize 清理、ScrollBox 背景裁剪和 NO_COLOR；main IO 验证流式、完成与 resume 的统一样式。真实 40×24 PTY 记录及 cell 读回确认底色、加粗、前景色、圆点同行和背景隔离，Ctrl+D 退出码 0，终端模式恢复。Standards 无发现；Spec 发现的纯空白片段圆点问题已补红绿测试并修复。
- 2026-10-03 最终验收：`rtk proxy env -u NO_COLOR bun run check` 全绿（格式、lint、`tsc -b`、Knip，371 tests / 2248 assertions，0 failures）；Spec 修复复核无剩余发现。
- 2026-10-02：新增 `design-system/`，导出唯一 dark 主题及 10 个 token、ThemeProvider/useTheme、ThemedText/ThemedBox、figures 与 StatusIcon。ThemedBox 保持 Box 的布局职责，通过 context 为后代 ThemedText 提供前景色；支持 token、原始颜色和局部覆盖，不修改渲染器原语。
- 入口包上 ThemeProvider；user 使用 `❯`，流式与完成的 assistant 共用 accent 色平台字形；工具 running 使用 accent 色 `·•●•`，success/error 分别使用 success 色 `•` 与 error 色 `✗`。成功结果与错误以 `⎿` 引出，后续行缩进两格，错误最多三行；实时与 resume 回放均传递工具结果。notice 为 warning 色，run 错误为 error 色，状态栏 subtle 色且 Running 为 accent 色。权限对话框、输入框和 logo 留待票据 04/05。
- 既定 render + headless terminal seam 完成 token 前景色红绿测试；补充 Provider/useTheme、ThemedBox 颜色继承、原始颜色与兄弟节点隔离验证。更新现有消息、工具、notice 和 resume 断言；运行帧 `•` 与成功点 `•` 通过前景色区分。类型检查在实现过程中重复通过。
- 最终执行 `rtk proxy env NO_COLOR= bun run check`，格式、lint、`tsc -b`、Knip 与全仓库测试全绿：235 tests / 1254 assertions，0 failures。执行环境自带 NO_COLOR，普通颜色验证显式清空，原有 NO_COLOR 专项测试保持通过。
- 手动验收：在 PTY 中通过 neant 的 main 入口 IO seam 固定 80×24，注入受控模型流，执行真实 bash 成功调用和四行失败输出，并显示 MCP notice、流式/保留 assistant、run 错误。ANSI 及终端 cell 读回确认全部目标配色、结果缩进和仅三行错误；Ctrl+D 退出码 0、终端模式恢复。未连接真实模型；临时 runner 与 ANSI 记录保存在 /tmp，未纳入仓库。
- code-review：以实施前 HEAD `81cdd2e47411fe3334b9001b89dca014fc6626b7` 为基线，对暂存实现分别进行 Standards 与 Spec 独立审查，均为 0 项发现。
- 2026-10-03 用户再次调整：取消用户消息浅灰背景，颜色对齐本机 dsh-TUI 深色主题 `userPromptLabel=#FFDF80`，前缀与正文均加粗，续行缩进两列并按参考为正文右侧保留三列；删除不再使用的 userMessageBackground token。更新组件、main IO 和 resume 的终端断言，定向 7 tests 全绿，覆盖无底色、金色加粗、多行/缩放及历史回放。
- 本次最终验收：`rtk proxy env -u NO_COLOR bun run check` 全绿（格式、lint、`tsc -b`、Knip，371 tests / 2250 assertions，0 failures）。40×24 真实 PTY 及 cell 读回确认金色加粗、无背景填充与模型圆点同行，Ctrl+D 正常退出并恢复终端；Standards 与 Spec 独立审查均无发现。
