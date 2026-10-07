# 01: 用户消息与流式 Markdown 正文

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 用户在实际 Session 中看到参考样式的用户消息与 assistant 正文，Markdown 随内容到达正确排版并平滑显示，回复结束和历史恢复都完整可读。必要的呈现整理先在本工单完成，并以这条可运行路径验证。

规范用户故事：1–7、46–48、55、58–61。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 用户气泡、指针、assistant 标记、颜色、缩进和间距对齐固定参考；保留 Neant 品牌与中英文文案，普通正文不整段绑定折叠。
- [x] 流式 Markdown 覆盖普通段落、列表、代码块及参考支持的其他块结构；未闭合到闭合的转换保持内容与布局正确，不把生成中的原始 Markdown 一律当普通文本显示。
- [x] 已结束的空 assistant 消息不留孤立标记；正文与已有工具消息交错时顺序正确，不重复显示。
- [x] 默认约 30fps 自适应平滑追赶；生成结束后继续显示全部已到达正文，内容替换按参考规则收束，展示节奏不改变 Session 事件或 Transcript。
- [x] 新会话历史恢复直接显示完整正文，不重播动画；本工单需要的事实可从保存内容重建，不增加老会话兼容。
- [x] 向上阅读、回底与 resize 保持既有阅读位置和跟随行为；小终端、中断与退出能力不回归。
- [x] 复用 start/startWithClock、可控模型和 headless terminal，验证流式块转换、尾部追赶、历史显示、颜色及 Unicode；定时场景使用虚拟时钟。
- [x] 将公共呈现能力放在现有分层中的所属模块；内部接口改变同步更新消费者并移除废弃分支，不增加并行消息执行链。

## Comments

2026-10-07：在 `codex/streaming-parity-01` 实施。固定参考核对了 UserPromptMessage、AssistantTextMessage、StreamingMarkdown、smoothReveal、terminal-utils/markdown、MarkdownTable、CodeBlockFrame、math 与 Mermaid。用户金色气泡沿用已有无背景、悬挂缩进；assistant 标记改为正文色，空消息不绘制。CommonMark/GFM、TeX Unicode、Mermaid、代码框及平滑呈现归属 `@neant/tui` design system，全部现有 Markdown 和工具动画消费者迁到公开入口，原 app 私有模块删除。Pi LaTeX Unicode 源文件保留 MIT 归属和许可；解析／图形依赖按精确版本锁定并更新技术栈。

正文 live→final 使用同一身份游标，Run 结束继续追赶尾部，新到达的一次性最终回复也平滑显示；历史直接完整绘制。替换立即收束。固定参考的 completedReveals 在追赶完当前 backlog 后记住身份，因此同身份后续增长直接显示；公共虚拟时钟场景覆盖此规则，不将其误写成重新播放。展示数据仅属于 frontend，不新增 Core 或持久化字段。

公开 `startWithClock` 场景覆盖颜色、Unicode、open→closed fence、段落／标题／列表／引用／分隔线、GFM 表格与任务项、数学的美元／括号／方括号／环境分隔符、pending／unsupported 保留源文、Mermaid Unicode、30fps 边界、尾部追赶、一次性最终内容、Session Resume、替换与结束身份，以及正文搜索不匹配隐藏 Markdown 定界符或链接地址。已有 fullscreen 和跨 microtask streaming-burst 场景验证阅读跟随、resize、小终端、退出及 stderr。

验证：`env -u NO_COLOR bun test apps/neant-tui/tests/e2e/messages.test.ts` 8 个场景通过，单个新增场景约 80–220ms；messages/tool-reveal/fullscreen/streaming-burst 相关场景通过。共享消费者的 plan-review/subagent-views/transcript-search focused 检查发现两处旧测试需要以当前公开显示同步：计划末尾不再存在空行，八个 child 的父回复在 Run idle 后仍需追赶。修正后对应 40/80 列长计划及八 child 场景通过。已有 streaming-burst 两个大场景约 2–3s，保留其 microtask、真实 Session 和阅读压力覆盖；本票动画场景全部使用虚拟时钟。

`bun run check:dev` 通过（格式、lint、类型、Knip、scratch tracker），`git diff --check` 通过。完整 `env -u NO_COLOR bun run check` 由 integration 在最终代码状态统一运行；本票不重复全量 gate。

合入 integration `1bd5980` 后重新验证：`env -u NO_COLOR bun test apps/neant-tui/tests/e2e/messages.test.ts apps/neant-tui/tests/e2e/tool-reveal.test.ts apps/neant-tui/tests/e2e/transcript-search.test.ts apps/neant-tui/tests/e2e/plan-review.test.ts apps/neant-tui/tests/e2e/subagent-views.test.ts` 全部 47 个测试通过（225 assertions，10.32s），保留 05 的任务样式与搜索投影。合入后的 `bun run check:dev` 通过，工作区干净。
