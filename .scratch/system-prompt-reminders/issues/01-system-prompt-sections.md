# 01：System Prompt 分节生成

Status: claimed

**What to build:** 按 [spec](../spec.md#system-prompt工单-01) 与 [ADR-0046](../../../docs/adr/0046-system-prompt-sections-and-reminder-roles.md)，根 Session 用 `section()` 生成 System Prompt，子代理通用规则并入 `SUBAGENT_PROMPT`。

- [x] 各节按已注册工具、平台与 shell 输出；时间、Git 分支与状态不进入
- [x] 环境节给出 cwd、附加目录与平台；Session Move 后追加新环境节；`environment` 快照只保留 Git 分支与状态
- [x] 回复语言、指令优先级、System Reminder 可信度、用户数据目录禁读
- [x] `SUBAGENT_PROMPT` 加入子代理规则
- [x] `contextUsage`、`contextReport`、Side Question 使用实际渲染的 System Prompt
- [x] 测试：相同输入字节一致、日期不影响、cwd 只改变环境节、Compaction 后环境节仍在、Session Move 与 Resume/Rewind 投影一致、工具集差异、子代理与 Side Question 文本
- [x] 文档：`docs/architecture.md` 模型上下文一节，CONTEXT.md Session Move 词条中的环境快照描述

## Comments

- Claimed by implement_01 on feat/reminders-01, base 467b8a75. Pre-agreed seams: public createSession, fake model contexts, Transcript and context reporting; TDD vertical slices. Root coordinates aggregate verification.

- 实现：根 Session 注册稳定 `section()`，身份留在 `instructions`；环境节保留 cwd、附加目录、平台、实际 Bash runtime 和用户数据禁读边界，Git 快照独立且 Compaction 不重发。子代理通用规则与 Side Question、Context Usage/Report 的实际文本同步。日期行为留给 03。
- 验证记录：01-red-1.log（缺少 environment section，249ms）→ 01-green-1.log（11 pass，654ms）；01-red-2.log（首次 Side Question 缺少原生 instructions wrapper，148ms）→ 01-green-2.log（1 pass，194ms）；01-red-3.log（实际工具注册名不匹配，175ms）→ 01-green-3.log（1 pass，209ms）。公开 seams 均经规格 Testing Decisions 预先确认。
- Focused：`bun test packages/agent/tests/e2e/reminders.test.ts packages/agent/tests/e2e/session-move.test.ts packages/agent/tests/e2e/compaction.test.ts packages/agent/tests/e2e/context-usage.test.ts packages/agent/tests/e2e/side-question.test.ts packages/agent/tests/e2e/subagents.test.ts`：68 pass / 0 fail / 468 assertions，4.83s。`bun test packages/coding-agent/tests/headless/e2e/cli.test.ts -t 'stream-json'`：14 pass / 0 fail / 129 assertions，4.45s。单项均低于 1s，无固定 sleep。
- Root 协调执行 `bun run check:dev`：exit 0，01-check-dev.log；格式与 `git diff --check` 通过。评审核对 Bash registry 的 `bash -c` invariant；无 bash 注册时改为明确无命令工具，失效范围仅该提示词文案，使用 focused case 与定向 oxlint/格式增量验证，不重跑 aggregate。
- ADR coverage：沿用 ADR-0046 的 section/cache boundary 与消费者约定、ADR-0016 的 Git-only environment 快照；无新增架构取舍。文档更新 architecture 模型上下文与 CONTEXT Session Move。维持 claimed，等待全规格评审；CI 未运行，不声明通过。完整外部证据：`/tmp/rukie-reminders-evidence/01.md` 及统一 verification.md。

- Final acceptance repair: current User Instructions header is attributed by the context-report owner alongside Project Instructions; no compatibility path added. Existing public memory-file attribution and superseded-snapshot reproducer both failed before repair, then passed. Related context-report/context-usage consumer coverage included in 62-pass focused run. Minimum reproduction: 8 fail / 0 pass, 704ms; corrected minimum: 8 pass / 0 fail, 659ms. Expanded affected files plus direct context/admission consumers: 62 pass / 0 fail, 359 assertions, 3.83s; no case over 1s. Agent types and affected lint pass. Original aggregate remains failed (8 failures), later stages unrun; root coordinates remaining acceptance. Full commands/logs: `/tmp/rukie-reminders-evidence/acceptance-fixes.md`. Status remains claimed.
