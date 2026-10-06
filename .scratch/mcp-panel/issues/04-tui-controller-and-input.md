# 04: TUI MCP 接线、导航与输入锁定

**What to build:** 无参数 `/mcp` 打开四层面板，实时读取 Core 状态，接通管理动作、Interaction 暂停恢复与严格主输入锁。详见 [spec](../spec.md) 的页面导航及输入、Interaction 与生命周期。

**Blocked by:** 02, 03

**Status:** resolved

- [x] 替换旧无参数文本 report 路径，命令不调用模型、不写 Transcript；保留有参数子命令与补全，删除仅服务旧 MCP report 的过时分支和断言，保留其他 report 消费者。
- [x] screen 维护四层页面、稳定身份焦点与每页滚动位置；↑/↓ 循环、单击进入、滚轮选择、详情 Tab 正文/操作切换、正文翻页、逐层 Esc 和鼠标返回可用。
- [x] 打开/操作完成/状态事件读取共享快照，不轮询或强制探测；loading 自动转列表，空/错保留面板。用户重试明确调用 Core 强制刷新，Run 中 busy；刷新保留有效项，消失退回有效上级并提示。
- [x] 管理动作复用公开 Session API；Run 中管理 busy、浏览可用；重复动作被拒绝，成功/失败/取消留在原详情并刷新结果。
- [x] Interaction 优先接管渲染与输入，FIFO 处理完恢复 MCP 页面、选择及滚动；OAuth 回调 URL 输入正常，授权结果回原详情。
- [x] 全部 MCP 页面禁用主输入字符/提交/粘贴/图片/历史/补全，主输入编辑光标隐藏；面板开启时失效既有异步输入处理，关闭后晚到结果也不能修改草稿或附件。
- [x] Ctrl+C 在 Run 中中断并关闭面板，空闲关闭；Interaction 保留既有取消行为。小于40×12暂停面板交互但保留状态与退出能力。
- [x] 共存 Todo/Subagent/Goal 预览，保持 Transcript 阅读位置；Session 换页/Resume、卸载、退出清理面板与订阅，旧结果不串 Session，不阻止终端恢复。
- [x] `start` + headless terminal 的 public TDD 覆盖四层交互、Core 事件、动作结果、FIFO、busy、主输入锁及晚到 clipboard/image 结果，完成 focused 与静态检查并记录证据。

## Context pointers

- [chat screen](../../../apps/neant-tui/src/screens/chat/index.tsx)、[MCP commands](../../../apps/neant-tui/src/screens/chat/mcp-commands.ts)、[Interactions](../../../apps/neant-tui/src/screens/chat/interactions.ts)。
- [MCP command tests](../../../apps/neant-tui/tests/e2e/mcp-command.test.ts)、[OAuth panel tests](../../../apps/neant-tui/tests/e2e/mcp-auth.test.ts)、[app helper](../../../apps/neant-tui/tests/helpers/app.ts)。

## Comments

2026-10-06：设计已确认，尚未实施。必须在02、03共同集成后开发，不能提前替代接口或复制组件。

2026-10-06：04 已实施，独立 worktree `/Users/artorias_chan/.codex/worktrees/mcp-panel-04/Neant`，分支 `codex/mcp-panel-04`。共同产品基线 `48ccc2e69f02062185a80ff7fd3293b9f660f6b2`；交付前 fast-forward 合入最新集成 `9d4a2a494355d6c35eed75e437e41fc2a1f3fd04`，包含用户已接受的集中完整检查策略。

- Screen 模块 `mcp-panel.ts` 维护稳定原始名称身份、四层页面、每页选择/正文焦点/阅读位置、结果与操作 generation；现有 `mcp-commands.ts` 共用一次在途公开读取、订阅 `mcp_servers_changed`、处理管理互斥并保留直接子命令通知与补全。无参数路径不再写 report，删除仅供旧报告的 copy 和断言。
- `Chat` 为面板优先分配实际高度并给持久面板保留预览；Interaction 使用实时 store 判断接管键盘和鼠标，OAuth 自定义 callback 输入继续由 Interaction 处理。所有主输入入口使用同步 owner 判断，打开时立即递增 paste epoch；同批打开/关闭、延迟 clipboard 与真实 FIFO 图片读取均不能回填。打开/关闭没有跳到底部，保持 Transcript 阅读锚点。
- 管理进行中仍能浏览，拒绝重复管理；状态变化保留有效原始身份，工具或服务器消失回到有效上级并显示变化提示，结果保留在对应服务器详情。关闭、Session 替换、卸载的晚到操作和读取不能重新打开面板或串到新 Session。小于40×12暂停导航而保留 Esc/Ctrl+C/退出规则。
- 真实 `start`/headless terminal TDD 首次空配置输入锁在原实现下红（仍显示旧报告），接线后绿；覆盖四层原始分隔符名称、正文恢复、列表鼠标 hover/滚轮/单击/返回/配色、Run busy/中断、问题队列恢复、OAuth 取消和 manual callback 成功、配置修复重试、微任务工具移除及重复提交、loading 关闭与换 Session、40×12真实 Goal/Todo/Subagent 预览、小终端 zh/en 暂停恢复、Transcript 锚点、延迟 clipboard 文本/图片与真实 mkfifo 图片读取、同批打开/Ctrl+C关闭。同步关闭的补充测试也复现并修正了 opening guard 误吞 Ctrl+C 的问题；服务器正文焦点不会用 Enter 执行管理。
- 诊断行把错误置于路径前，避免长配置路径完全遮住错误前缀；对应公开 malformed-file 回归和组件诊断/布局断言通过。已审查 Standards/Spec：职责留在 screen 与 props-only component，未改 Core、配置读取或凭据语义，没有轮询。
- 检查均使用临时 HOME、unset NO_COLOR。相关公开回归 `bun test` 指定 MCP panel/command/auth、image-clipboard/image-tokens、todo-panel/subagent-panel/subagent-interactions、chat/goal 九个文件：**118 pass、0 fail、544 assertions、36.61s**，日志 `/tmp/neant-mcp-panel-04-focused.log`。最终输入分派修正后，MCP 三个文件重新运行：**43 pass、0 fail、146 assertions、21.03s**，日志 `/tmp/neant-mcp-panel-04-final-focused.log`。组件+当时 MCP panel 相关检查：**34 pass、0 fail、155 assertions**，随后组件没有其他变化。
- 当前 `oxfmt --check`、`oxlint`、`tsc -b`、`knip` 和 `git diff --check` 全部 exit0；静态日志 `/tmp/neant-mcp-panel-04-final-static.log`。本票没有运行 aggregate 或全量无关测试，完整检查由05最终集成节点集中执行。
- 05 继续做增量跨概念验收与文档，优先补 mixed permission/OAuth/subagent FIFO 保留 MCP、同一 Run 的 auth/challenge 状态变化、Resume 不恢复本地面板、服务器消失/最后工具消失的祖先退回、管理失败反馈的组合场景。04 的上述公开测试已有 coverage，不应机械重复整个组件/Core 矩阵；真实账号 OAuth 验收仍归原 OAuth 工单，不能以本地 fixture 关闭。
