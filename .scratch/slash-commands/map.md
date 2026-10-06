# Slash commands implementation map

## Notes

Spec: [slash commands](spec.md). Local Markdown tracker; tickets resolve through their Answer sections.

## Decisions-so-far

- [01: 命令框架与补全菜单](issues/01-command-framework-and-menu.md#answer) — frontend 清单与处理器入口、props-only 菜单、clear/resume binding、Core skill 列表和单队列项 skill steer；既有普通忙碌草稿与子代理调度保持。精确整合 HEAD 的 full check 由整个 spec 交付完成。

- [05: /model 切换](issues/05-model-switch.md#answer) — registry 清单、空闲切换与持久化恢复、当前模型 getter / Tool State 事件、窄终端焦点窗口 picker；继承子代理只对新建者生效。
- [02: 手动 compaction](issues/02-manual-compaction.md#answer) — idle Session API shares automatic persistence/hooks/reminder lifecycle; manual focus, localized no-history errors, cancellation/disposal, resume and TUI progress verified.

- [08: /settings 占位页](issues/08-settings-placeholder.md#answer) — 全屏 ④ 层设置框架与本地字段接口，空分区中英文案、稳定页脚与 Esc 返回；不写回设置，run 中拒绝。

- [03: Session 标题与改名](issues/03-session-title-and-rename.md#answer) — 一次异步标题、专用模型、手动固定与取消、子/fork 描述、Headless、TUI 预填和 OSC spinner；辅助模型边界隔离及 Session 存储竞争已覆盖，回退保留手动来源且普通锚点不变。

- [07: /btw 侧问](issues/07-side-question.md#answer) — 独立模型/恢复上下文快照、无工具或 Session 副作用、可取消文本迭代；TUI 流式 pane、替换与 Esc 关闭，辅助测试队列保留标题优先路由。

- [06: /context 上下文报告](issues/06-context-report.md#answer) — read-only restored-context accounting and provider totals; local immutable TUI visualization with four grid sizes, screenshot colors, resource summaries, /context all details and active-run support.

- [04: /resume 选择器](issues/04-resume-picker.md#answer) — 原生会话摘要和 live store lease 借用，排除子/旧版子会话、保存模型优先；两行有界暗色 fallback picker、Esc、空/忙提示与标题/模型/对话重建已覆盖。

## Fog

- None. 01–08 全部 resolved；双轴审查与最终全量验证完成，详见 [spec Answer](spec.md#answer) 与 [review](review.md)。

## Final delivery

- Branch: `main`；合并提交 `48f74550a2062c8cea9458c3052a4c9daaadcfc4`，包含原最终整合 `efd8f67d81773da2e0c02cd1406fa0f28022287a`。
- Main full check: 1713 pass、0 fail、9060 assertions、134 files；静态检查全部通过。
- 原 Standards / Spec 各解决 1 项，主分支合并复审另解决 1 项本地化问题，两轴无剩余发现；九个 managed worktrees 已归档并移除，全部本任务临时分支已删除。
