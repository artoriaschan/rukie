# 03: 抽出 view 层并加依赖边界

Status: ready-for-agent
Blocked by: 02

**What to build:** 把与终端无关的呈现逻辑从 `tui/` 移到 `src/view/`，再用 lint 固定 `headless/`、`tui/`、`view/` 的依赖方向。见 [spec](../spec.md) 的"目录"和"依赖方向"。

迁移清单：

- `view/conversation/`：`screens/chat/conversation.ts`、`completed-visibility.ts`、`subagents.ts`、`activity/`
- `view/commands/`：`screens/chat/commands.ts`
- `view/transcript/`：`screens/chat/transcript-search.ts`、`components/tool-call/presentation.ts`、`diff-lines.ts`、`components/subagent-message/presentation.ts`、`job-card/output.ts`、`status-line/metrics.ts`；并从组件文件中拆出 `markdownProjection`/`markdownText`、`jobCardRows`、`contextText`
- `view/i18n/`：`tui/i18n/` 整体移入
- 留在 `tui/`：`composer-images.ts`、`mcp-commands.ts`、`logo/`

- [ ] 迁移完成后 `view/` 不导入 react、`ink/`、`tui/` 和 Node API；`conversation.ts` 的 `basename` 改为字符串切片，并加 `ponytail:` 注释说明不处理 Windows 分隔符
- [ ] `tui/` 用到 `alignSplitDiff` 等 ink 能力的位置，只经 `ink/index.ts` 导入
- [ ] `image-gallery` 的 `inspectImage` 调用上移到 screen，`tui/components` 对 agent 只做类型导入
- [ ] spec 中各条依赖方向规则都已加入 `.oxlintrc.json`，每条做过负向验证
- [ ] 测试随源码移到 `tests/view/`；architecture.md 的 UI 分层一节改为新分层
- [ ] `env -u NO_COLOR bun run check` 通过
