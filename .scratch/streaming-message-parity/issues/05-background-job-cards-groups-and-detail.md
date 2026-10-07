# 05: Background Job 卡、分组与详情

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 用户能在会话中观察真实后台任务的最新输出，打开对应详情或展开命令，并通过任务分组清楚掌握多个任务的结果。

规范用户故事：26–32、44、48、55、57、60–61。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 以真实 bash 显式后台启动和前台超时转后台验证卡片路径；展示真实 ID、状态、命令和耗时，缺失进度省略或标未知。
- [x] 输出固定最后两行视觉行，长行先按宽度处理再取尾部，状态标记、标题和间距对齐参考。
- [x] 标题点击打开 jobs 面板并聚焦对应 ID；正文独立展开／折叠命令，两个入口互不误触。
- [x] 至少两个相邻任务显示分组轨与摘要；至少三个任务全部结束时默认自动折叠，摘要仍显示失败／终止计数，点击可展开。
- [x] 运行、stopping、完成、失败和 killed 更新来自真实任务状态；输出缺口与详情数据不可用按事实披露，不影响 Frontend 独立输出游标。
- [x] 卡片、分组和 jobs 面板的键盘、鼠标、滚轮、焦点及返回行为对齐参考，更新和 resize 不夺走阅读位置。
- [x] 保留 Background Job 的资源归属与结束通知语义；Session Resume 不恢复活任务，历史工具不误关联新任务，Session dispose 正确清理。
- [x] 复用 start/startWithClock 和 createSession 的现有入口，验证真实任务输出、状态收束、组阈值、失败计数、详情聚焦与恢复；进程契约的真实时间等待注明原因。

## Implementation evidence

- JobCard now owns command expansion independently of the jobs title action, uses the actual JobView timestamps for elapsed time, preserves a two-visual-row output tail, and discloses dropped output. Current jobs render once through their dedicated card; historical bash results keep their ToolCall presentation.
- Adjacent pairs show a bracket rail and state summary. Auto folding requires at least three settled jobs; each group has its own override and global expansion takes precedence. Failed and killed counts retain their error color while folded.
- Title actions open the jobs panel at the exact ID with details already expanded. Detail output, independent frontend cursors, timeline, exit code, signal and spill-file disclosure remain available. Existing Session resource ownership and resume behavior are unchanged.
- Public TUI checks: background-jobs, jobs-panel and transcript-search passed (34 tests, 12.81s), including mixed stopped/failed summary and virtual-clock elapsed/freeze cases (313.52ms and 91.21ms). New independent command/detail case took 174.56ms; pair threshold/group isolation took 238.58ms.
- Static checks: `rtk proxy bun run check:dev` passed. Final integration-wide check is owned by the integration agent after all tickets merge.
- Remaining cases above one second are existing real child-process contracts: stop-resistant process escalation (~3.26s) and status-chip elapsed observation (~2.14s). File gates and observable terminal/model completion synchronize the new process scenarios; display elapsed time uses the virtual clock.
