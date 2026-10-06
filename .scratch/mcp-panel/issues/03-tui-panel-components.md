# 03: TUI MCP 四层面板组件

**What to build:** 服务器列表、服务器详情、工具列表和工具详情采用同一通用 Design System 框架；组件只消费 props，不连接 Session。详见 [spec](../spec.md) 的面板框架与页面导航。

**Blocked by:** 01

**Status:** resolved

- [x] 使用 Rewind flow 槽位样式、permission Divider、remember 标题、通用 ListItem/状态/HintLine/ScrollBox；采用现有主题，不创建专用视觉原语。
- [x] 服务器 project/user 分组与路径、稳定排序、状态与数量；工具名称与简介列表；hover 不改键盘 focus，单击回调直接激活项，边界滚动提示明确。
- [x] 服务器详情渲染安全展示数据、授权/错误/工具数与动作列表，正文/动作焦点提示可见；工具详情渲染完整描述与格式化 schema。
- [x] 标题/底部提示固定，正文独立滚动；上界14行且不超过 screen 提供的预算，有界焦点窗口，focus 变化不造成高度抖动。
- [x] loading 自动等待后续 props、空配置路径、文件级错误/部分合法列表/全局失败重试与单服务器 failed 行均有可操作呈现；busy 动作反馈与结果有明确槽位。
- [x] 同步 zh/en 字典；40×12、长名称/URL/schema、resize、theme 与其他面板预算保持可用，低于下限由 screen 暂停操作。
- [x] 验证组件实际终端呈现与布局，不写镜像实现的纯快照测试；完整 `start` 接线回归由 04、05 覆盖。本票可与 02 独立开发。

## Context pointers

- [RewindPicker](../../../apps/neant-tui/src/components/rewind-picker/rewind-picker.tsx)、[ModelPicker](../../../apps/neant-tui/src/components/model-picker/model-picker.tsx)、[panel layout](../../../apps/neant-tui/src/components/panel-layout/index.ts)。
- [ListItem](../../../packages/tui/src/design-system/list-item.tsx)、[renderer README](../../../packages/tui/README.md)、[app i18n](../../../apps/neant-tui/src/i18n/locales.ts)。

## Comments

2026-10-06：设计已确认，尚未实施。本票不处理 Session、命令解析、输入分派或 OAuth 生命周期。

2026-10-06：03 implementer 在 codex/mcp-panel-03 认领；共同基线 e6299bb。按已确认组件 props 与实际终端渲染边界进行 TDD；不接 Session、命令或主输入。

2026-10-06：四层纯 props `McpPanel`、身份选择与实际 flow 高度 API 已完成；沿用 permission Divider、remember 标题、ListItem/StatusIcon/warning、HintLine 和 ScrollBox。zh/en 同步；文件诊断固定重试、busy 仅禁用管理、鼠标直达与独立正文阅读均有终端证据。`ScrollBox` 的短内容到长内容更新在公开渲染边界复现 top 0→25；新增默认行为不变的 mount-time `followOnReachBottom`，MCP 阅读页选择 false，以仅限制有效 top 而不启用跟随。包 README 记录该公共契约。

2026-10-06：开发 red→green 记录包括缺失组件、无界列表、加载/诊断缺失和同一工具正文增长跳到末尾。新增 MCP 与 ScrollBox 公开终端测试共 24 pass、0 fail、107 assertions（2 files）；覆盖 project/user、协议身份、hover/click、滚轮、body/actions、忙时浏览/返回、schema/resize/恢复/内容收缩、0–14 行预算与 40×12 的 MCP+Goal/Todo/Subagent+prompt。whole-repo format/lint/types/Knip 与 diff check 当前通过；完整 aggregate 和最终合入最新集成基线的验证尚待，状态保留 claimed。

2026-10-06：首次合并 02 `25e0c198` 后完整检查为2353 pass、1 fail、12067 assertions、168 files、344.02s，唯一失败为既有 permissions 用例取消审批后立即提交多行草稿的等待超时。原用例在03和未改的02共同基线分别独立复现同一 :490 失败；审批面板消失不代表取消的 Run 已结束。按仓库公开完成同步规则，仅在原测试的 panel-hidden 谓词之后补 `!app.isWorking()` 等待，保留草稿与后续模型输入断言，不改超时或生产 UI。该精确用例从 red 转为 green；日志 `/tmp/neant-mcp-panel-03-question-{rerun,baseline,fixed}.log`，原 aggregate 日志另保留 `-check-first.log`。

## Answer

四层 `McpPanel` 已交付，组件只消费 props，未接 Session、Slash Command 或主输入。共用 Rewind flow 框架及现有 Design System；服务器按 project/user 与名称稳定排序，工具按原协议名称排序。安全连接元数据、已知错误本地化、完整描述和 JSON Schema、独立正文阅读、固定标题/提示、busy 与结果槽位、诊断固定重试、鼠标激活和逐层返回、zh/en、0–14 行预算、40×12 共存及 resize 均有实际终端回归。

04 接口位于 [组件入口](../../../apps/neant-tui/src/components/mcp-panel/index.ts)：`McpPanelPage` 的 servers/server/tools/tool 联合、`McpPanelProps`、`mcpPanelChoices(page)` 和 `mcpPanelHeight(props)`。选择 key 为 `server:<原名>`、`tool:<原协议名>` 或 tools/login/logout/reconnect/back/retry；名称可含冒号，调用方只能移除固定前缀。tools 页含固定 Back 动作。screen 负责页面、键盘、稳定选择、focus(body/actions)、管理、Interaction 与每页滚动；鼠标通过 onActivate/onListWheel/onBodyFocus/onBodyWheel 回调。正文句柄使用 scrollBy/scrollToBottom/getSnapshot，离页前保存 top，再以 initialTop 恢复；已有 body key 在同一身份数据更新时保留当前位置并限制有效范围。轮滚回调已按正文/动作实际区域路由，screen 避免再全局处理同一事件。maxHeight 是完整 flow 预算，mcpPanelHeight 报告实际行数；0 行不显示、1 行标题预览、2 行标题+提示，详情至少5行可同时保留正文与动作。interactive=false 暂停鼠标与选中行光标；管理 busy 不禁用浏览/返回。result 是已本地化操作或页面变化文案。

验证：新组件与 ScrollBox 的实际终端回归25 pass、0 fail、110 assertions（2 files）；此前扩展 renderer/组件/Rewind 集为273 pass、0 fail、1466 assertions（31 files），日志 `/tmp/neant-mcp-panel-03-focused.log`。鼠标返回修复已 red→green；取消后草稿提交用例在03和未改02分别 red，再通过公开 idle 谓词 green（1 pass、0 fail、6 assertions，262.88ms，日志 `/tmp/neant-mcp-panel-03-question-fixed.log`）。已合并当前集成 `25e0c19853f5a8c86ec2054f1cdb05c08aeb3c88`，完整项目 format/lint/types/Knip 在合并后的 aggregate 前置阶段通过。

2026-10-06：用户明确将验证策略改为相关回归通过后推进独立接线，完整检查集中在集成节点。03 因此以以上公开回归与静态证据 resolved，04 可以开始。第一次 worker aggregate 的既有取消用例失败及差分/修正证据保留于 Comments；已启动的第二次 aggregate 仍在后台运行，日志 `/tmp/neant-mcp-panel-03-check.log`，它只是额外证据，不阻塞本票、不重复启动 full。最终完整检查由集成收尾执行。
