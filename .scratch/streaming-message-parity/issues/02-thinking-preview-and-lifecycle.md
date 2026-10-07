# 02: 思考预览与生命周期

Status: resolved
Blocked by: 01

**What to build:** 用户在真实流式回复中查看三行最新思考，按需切换全文，并在正文、工具和完整回复结束的正确边界看到思考收起及真实历史信息。

规范用户故事：8–12、39–40、55–56、60–61。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 默认 preview 固定三行最新视觉内容，最后一行按参考截断并保留最新 token；长行、中文和 Unicode 不越界。
- [x] 点击切换预览与全文，标题、标记、提示、颜色和命中区域对齐参考，正文选择不误触切换。
- [x] 首个正文 token 或工具调用到达时收起 preview；full 按参考的完整回复结束边界收起，将参考边界映射到 Neant Run/Turn 事实而不改领域定义。
- [x] 思考全文复用已完成的平滑显示；展开和历史内容完整显示，完成时不漏尾部。
- [x] 展示可获得的真实耗时或 token 信息；仅报告 token、缺失耗时等情形按真实数据呈现，必要且无法重建的历史事实在本工单补齐。
- [x] 新会话恢复可重建保存的思考及必要历史信息，界面状态用默认值；保留已持久化的中断／错误思考，不创建 attempt 提交模型。
- [x] 通过 start/startWithClock 验证三行预算、末行截断、点击、正文／工具触发收起和完整回复结束；新增保存事实使用 createSession 验证恢复。
- [x] 验证窄终端、resize、阅读锚点及中英文；计时边界用虚拟时钟，清理等待公开完成信号。

## Implementation and verification

- 默认思考 ticker 保持三行，长行按 grapheme 显示宽度裁剪。最后一个实际内容行保留最新 token；只有一行时仍如此，其余行填充空格。固定参考将截断起点硬编码在第三物理行，导致一行长文本的最新 token 被裁掉；此处按父规范的最新 token 条件修正该边界。
- 标题使用 80ms braille、蓝色 pulse、settled ⚓、斜体标签与中英文 Ctrl+O 提示；点击热区仅标题，全文/预览正文保留选择边界。首次正文或工具 input 收起 preview，单行 full 跨工具与多个 Turn 保留，Run 结束清除单行 full；全局详情继续由现有 Ctrl+O 管理。
- 对照参考 MessageList 1418–1450 的 reasoning reveal，live full 使用共享 useSmoothText，ticker 使用已到达原文；phase settle 后 full 继续追赶尾部，历史/无 live cursor 的展开立即显示。Markdown 新增 dimColor，代码语法色与 dim 同时保留。
- Agent Core 保存实际观察到的阶段墙钟耗时 `neantThinkingDurationMs`，首次非空思考至首个正文 token / tool input / assistant settlement；公开 `assistantThinkingDuration` 校验 native assistant metadata。单一路径随 Transcript 保存，模型边界剥离，正常/error/aborted 的已提交消息在 Resume 一致。锁定 pi 未提供思考 token count，省略该未知字段。
- 模型 fake fixture 保留真实工具消息中的先前思考，使跨 Turn 生命周期由真实 Session Run 驱动。
- TDD：新增首轮 preview 与 full 生命周期公共 TUI 场景先失败（旧实现无 ticker），随后实现；所有新增验证通过既有 startWithClock / createSession 入口。思考内容替换保持三行与标题位置，窄终端/resize、中英文、工具边界、正文点击、平滑尾部、历史默认状态和 dim syntax 单元格均有公开终端断言。
- `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/thinking.test.ts apps/neant-tui/tests/e2e/tool-expansion.test.ts apps/neant-tui/tests/e2e/messages.test.ts packages/agent/tests/e2e/thinking.test.ts packages/agent/tests/e2e/session-recovery.test.ts`：29 pass / 0 fail / 170 assertions，3.85s。新增 TUI 场景各 39–163ms，新增 Agent Core 场景 18–23ms。既有 reading-anchor 场景 1.14s，未增加其运行成本。
- `bun run check:dev`、`bunx --no -- tsc -b` 通过。最终 aggregate check 由 integration branch 在全部工单合并后统一执行。
- Ticket 08 integration：为 ThinkingRow 的 spinner/anchor wrapper 与 preview rail wrapper 添加 `selectable={false}`，由拥有 selection API 的工单在合并后接入。
