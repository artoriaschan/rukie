# 06: System Prompt 与 System Reminder

**What to build:** 让模型在每个 Session 里都拿到稳定的身份信息和环境上下文。

- **System Prompt**：一份静态文本，内容是 coding agent 的身份、工具使用规范和风格，构建时内联进代码。所有项目都用同一份，里面不放任何环境信息或项目信息。
- **System Reminder**：定义一种自定义消息类型，在 `convertToLlm` 时转成包着 `<system-reminder>` 的 user 内容。
  - Session 第一条 user 消息上注入：环境信息（cwd、平台、日期、git 分支和 status），以及 Project Instructions（用户级的 `~/.neant/AGENTS.md`；项目级的 `AGENTS.md`，没有时用 `CLAUDE.md`）。
  - resume 时如果日期变了，补发一条增量 reminder。
  - 所有 reminder 都写进 Transcript，以后不再修改。
  - text 输出里看不到 reminder 内容；stream-json 里会发出 `reminder_injected` 事件。
- 这张 ticket 要把"按来源比较、只补发变化的部分"做成通用机制，07 和 08 会在此基础上添加 skills 和 MCP 两种来源。

**Blocked by:** 05

**Status:** resolved

- [x] System Prompt 在所有项目和所有 Session 中逐字节相同
- [x] 首次 Run 时，环境信息和 Project Instructions 都附在第一条 user 消息上；`AGENTS.md` 优先，没有时用 `CLAUDE.md`；两个文件都不存在时不注入这部分
- [x] resume 后，之前注入过的 reminder 原样保留；日期变化时只补发日期这一条
- [x] 增量机制可以扩展：新的 reminder 来源只需提供"当前内容"，就能参与比较
- [x] Seam 1 测试覆盖：首次注入的内容；resume 后上下文前缀不变；日期变化时补发（时间可以在测试中注入）；`reminder_injected` 事件

## Comments

- 2026-10-01：`prompt` 维护代码内联的静态身份、工具规范与回复风格；新 Session 的初始 system 消息也写入 Transcript，resume 原样恢复。
- `reminders` 定义 `system-reminder` 自定义消息，通过 `convertToLlm` 转成 `<system-reminder>` user 内容；首次 Run 在原始 user prompt 之前注入环境、独立日期、用户级和项目级 Instructions。日期使用运行环境的本地日历日期，测试通过 `SessionOptions.now` 注入时钟。
- 环境和 Instructions 保留首次快照；日期和额外来源与 Transcript 中该来源最近的内容比较。`SessionOptions.reminderSources` 接受 `{ source, currentContent }`，07/08 可以直接接入，内容不变时不追加；所有已注入消息只追加、不改写。
- `reminder_injected` 在消息写入 Store 后发出，带 `sessionId`、`source`、`content`。text 输出仍只有最终 assistant 文本，stream-json 保留原生 pi 事件并包含 reminder 事件。
- Seam 1 新增 7 个测试，覆盖身份一致性、git 环境、两级 Instructions、回退与缺失、空 AGENTS.md 优先、JSONL 原始消息、resume 前缀、跨日增量和可扩展来源比较；Seam 2 更新事件顺序、跨进程前缀和中断持久化断言。
- 验证：`bun run check` 通过（格式、lint、`tsc -b`、knip、全量 69 个测试 / 295 个断言）；code-review 规范轴与规格轴各 0 项发现。
