# 05: transcript 问答摘要

**What to build:** 提问结束后，transcript 中 `ask_user_question` 的工具卡片显示"提问"摘要及每题一行"问题 → 回答"；拒绝回答显示"未回答"。resume 会话后显示一致，数据只来自 transcript 中的工具参数与结果，不额外存储。

Blocked by: 02（单题单选端到端提问）

Status: resolved

参考：[spec](../spec.md) transcript 呈现。

- [x] live 渲染：回答后工具卡片显示问答摘要
- [x] 拒绝回答显示"未回答"；run 中止的提问按普通中止工具卡片显示
- [x] resume 后同一会话渲染结果与 live 一致
- [x] 文案走 i18n（zh/en）
- [x] TUI seam 测试覆盖 live 与 resume

## Answer

`toolEntry` 统一处理 live 和 resume 的已完成工具条目，成功的 `ask_user_question` 使用本地化“提问 / Questions”标题，每题一行“问题 → 回答”；拒绝回答每题显示“未回答 / Unanswered”。错误和 run 中止沿用普通工具卡片。

摘要只使用已有工具参数和结果。用完整问题前缀和合法选项 label 候选定位回答，验证后续题目序列，支持重复题目、换行、箭头、多选和附言；只在显示时压平题目与回答内的换行，不修改模型结果或保存的数据。没有新增持久化字段或 store。

验证（2026-10-04）：

- 公开 `start()` + `controlledModel` seam：`question-summary.test.ts` 10 pass / 0 fail，覆盖 zh/en 回答、拒绝、中止的 live/resume 一致性，参数错误普通卡片，以及多题、多选、Other、重复题目和多行 label 边界。
- focused：`rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/e2e/question-summary.test.ts apps/neant-tui/tests/e2e/questions.test.ts apps/neant-tui/tests/e2e/resume.test.ts apps/neant-tui/tests/e2e/tools-and-notices.test.ts`：46 pass / 0 fail，4 files。
- `rtk proxy bunx tsc -b`：通过。
- 最终代码 full check：新建临时用户目录并验证 `homedir() === HOME` 后执行 `rtk proxy env -u NO_COLOR HOME="$issue05_test_home" bun run check`；格式、lint、类型、Knip 和全部测试通过，672 pass / 0 fail，56 files。临时目录已清理，没有改动真实用户设置。
- `/code-review` 固定点 `48e6b91`：Standards 最终 0 findings；Spec 发现的两个多行选项边界 P2 经修复和公开回归验证后，最终复审 0 findings。

代码 commits：`7a2cdb8`、`59dba0d`、`59ac715`。
