# Slash commands implementation map

## Notes

Spec: [slash commands](spec.md). Local Markdown tracker; tickets resolve through their Answer sections.

## Decisions-so-far

- [01: 命令框架与补全菜单](issues/01-command-framework-and-menu.md#answer) — frontend 清单与处理器入口、props-only 菜单、clear/resume binding、Core skill 列表和单队列项 skill steer；既有普通忙碌草稿与子代理调度保持。精确整合 HEAD 的 full check 由整个 spec 交付完成。

- [05: /model 切换](issues/05-model-switch.md#answer) — registry 清单、空闲切换与持久化恢复、当前模型 getter / Tool State 事件、窄终端焦点窗口 picker；继承子代理只对新建者生效。

## Fog

- Remaining Core capability and TUI handler tickets retain their existing dependency graph.
