# 04: TUI MCP 接线、导航与输入锁定

**What to build:** 无参数 `/mcp` 打开四层面板，实时读取 Core 状态，接通管理动作、Interaction 暂停恢复与严格主输入锁。详见 [spec](../spec.md) 的页面导航及输入、Interaction 与生命周期。

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] 替换旧无参数文本 report 路径，命令不调用模型、不写 Transcript；保留有参数子命令与补全，删除仅服务旧 MCP report 的过时分支和断言，保留其他 report 消费者。
- [ ] screen 维护四层页面、稳定身份焦点与每页滚动位置；↑/↓ 循环、单击进入、滚轮选择、详情 Tab 正文/操作切换、正文翻页、逐层 Esc 和鼠标返回可用。
- [ ] 打开/操作完成/状态事件读取共享快照，不轮询或强制探测；loading 自动转列表，空/错保留面板。用户重试明确调用 Core 强制刷新，Run 中 busy；刷新保留有效项，消失退回有效上级并提示。
- [ ] 管理动作复用公开 Session API；Run 中管理 busy、浏览可用；重复动作被拒绝，成功/失败/取消留在原详情并刷新结果。
- [ ] Interaction 优先接管渲染与输入，FIFO 处理完恢复 MCP 页面、选择及滚动；OAuth 回调 URL 输入正常，授权结果回原详情。
- [ ] 全部 MCP 页面禁用主输入字符/提交/粘贴/图片/历史/补全，主输入编辑光标隐藏；面板开启时失效既有异步输入处理，关闭后晚到结果也不能修改草稿或附件。
- [ ] Ctrl+C 在 Run 中中断并关闭面板，空闲关闭；Interaction 保留既有取消行为。小于40×12暂停面板交互但保留状态与退出能力。
- [ ] 共存 Todo/Subagent/Goal 预览，保持 Transcript 阅读位置；Session 换页/Resume、卸载、退出清理面板与订阅，旧结果不串 Session，不阻止终端恢复。
- [ ] `start` + headless terminal 的 public TDD 覆盖四层交互、Core 事件、动作结果、FIFO、busy、主输入锁及晚到 clipboard/image 结果，完成 focused 与静态检查并记录证据。

## Context pointers

- [chat screen](../../../apps/neant-tui/src/screens/chat/index.tsx)、[MCP commands](../../../apps/neant-tui/src/screens/chat/mcp-commands.ts)、[Interactions](../../../apps/neant-tui/src/screens/chat/interactions.ts)。
- [MCP command tests](../../../apps/neant-tui/tests/e2e/mcp-command.test.ts)、[OAuth panel tests](../../../apps/neant-tui/tests/e2e/mcp-auth.test.ts)、[app helper](../../../apps/neant-tui/tests/helpers/app.ts)。

## Comments

2026-10-06：设计已确认，尚未实施。必须在02、03共同集成后开发，不能提前替代接口或复制组件。
