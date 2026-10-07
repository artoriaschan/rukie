# 09: `--resume` 回显旧对话

**What to build:** 用户运行 `neant --resume <id>` 后，先看到这个 session 之前的对话（用户消息、助手回复、工具调用摘要），然后接着对话。TUI 和 `neant-cli` 共用同一个 Session Store，两边可以互相 resume。

Blocked by: 07

Status: resolved

- [x] `Session` 新增只读的 `messages`，返回内存中已经还原的 context 消息，不重新读文件；在 Agent Core 公开接口上测试：resume 之后包含之前的对话
- [x] TUI 启动时把旧的用户消息、助手文本和工具调用摘要（复用 07 的折叠行样式）写进 `Static`，然后显示输入框
- [x] 回显不包含 system reminder
- [x] resume 之后的新消息追加到同一个 Session
- [x] 测试走假终端 seam：先用 `neant-cli` 或 Agent Core 产生一个 session，再用 TUI resume 并断言屏幕
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：Session 通过同步只读 getter 暴露当前内存中的已恢复 context；新 Run 和 compaction 后读取当前消息，不额外读取 Session Store。公开接口测试覆盖恢复前的完整对话、新消息追加及再次打开同一 Session。
- TUI 在创建会话视图时把旧用户消息、助手文本和工具结果投影到 Static；按 toolCallId 匹配工具名与参数，复用实时调用的单行摘要、✓/✗ 和前三行错误预览。隐藏 System Reminder、thinking 和 compaction summary，成功工具输出不展开。自动提交首条 prompt 与后续 Run 均保留旧条目的单次 scrollback 输出。
- 新增 4 条假终端测试，位于 `apps/neant-tui/tests/e2e/resume.test.ts`，通过真实 Agent Core 创建 JSONL Session 后恢复，覆盖首次输入前回显、同一 Session 追加、同名工具独立匹配、错误预览、压缩后上下文以及隐藏保留的 Skill Reminder。恢复以当前 context 为准，压缩前的 Transcript 不重新回放。
- code-review：Standards 无发现；Spec 发现 compaction retainedTail 中已转换成 user 的 Reminder 会泄漏到回显，已通过 red-green 回归修复。恢复时按原 Transcript 的时间戳和内容还原 Reminder 类型，保留用户自己写的标签，并验证模型继续收到 Reminder。复审两轴均无剩余发现。
- 最终 `bun run check` 全通过：格式、lint、`tsc -b`、Knip，以及全仓库 223 tests / 1166 assertions。
