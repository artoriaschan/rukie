# 02: todo reminder 与 compaction 后重注入

**What to build:** 清单还有未完成项时，模型在新 run 开始时经 system reminder 看到当前清单；compaction 之后同一 run 的下一 turn 立即重新看到它。全部完成或为空时不打扰模型。

**Blocked by:** 01（`todo_write` 写入并在 resume 后恢复）

**Status:** done

参考：[spec](../spec.md)「Tool State 地基」反馈给模型 / compaction 后两条，「`todo_write` 工具」reminder 渲染。

- [x] Tool State 定义支持可选 reminder 渲染；带渲染的 Tool State 自动成为 `ReminderSource`（source 即 name）
- [x] `todo` 渲染：非空且有未完成项时输出带状态标记的清单 + 一句"按需更新"提示，否则 undefined
- [x] 走现有去重：每 run 开始、内容变了才注入；resume 后首个 run 照常注入
- [x] compaction 结束时立即把所有 Tool State 的当前 reminder 追加到摘要之后并写入 transcript
- [x] Tool State reminder 去重只比较最后一次 compaction 之后的消息
- [x] 不做催促 reminder；不改现有 skills / mcp reminder 行为

测试（seam 1）：

- [x] 有未完成项 → 下一 run context 含 todo reminder；全部完成 / 为空 → 不含；内容未变 → 不重复
- [x] resume 后首个 run 含 todo reminder
- [x] 触发 compaction 后，同 run 下一 turn context 中摘要之后紧跟 todo reminder

## Comments

2026-10-04：使用 `/Users/artorias_chan/.agents/skills/implement/SKILL.md`，按 `tdd` 的已约定 seam 1 分片 red → green 完成。首片先验证下一 Run 缺少 todo reminder 的失败，再实现可选渲染与自动来源注册；compaction 片先验证同 Run 摘要后缺少当前清单，再实现立即追加原生消息记录、摘要后投影及 Tool State 专属的去重边界。仅交付 02。

验证证据：

- `rtk proxy bun test packages/agent/tests/e2e/todo-reminders.test.ts`：10 pass / 0 fail，33 assertions。覆盖混合状态标记、按需更新提示、新 Run 去重、内容变化、完成/空表静默、resume、同 Run 立即重注入、连续 compaction、持久化后再恢复、完成/清空后的 compaction，以及保留尾部时的摘要 → 当前 reminder → 历史消息顺序。
- `rtk proxy bunx tsc -b`：实现期间多次通过。
- 审查前、重复逻辑修复后的 `rtk proxy env -u NO_COLOR bun run check` 均通过：698 pass / 0 fail，4338 assertions，58 files；新增保留尾部测试后总数为 699。
- 新增尾部测试后的首次完整验收受宿主 macOS Maintenance Sleep 打断：四项既有计时测试在约 291–307 秒后超时，电源日志记录了 300 秒的维护休眠。无产品改动；`caffeinate -i` 不足以阻止维护休眠，随后使用 `caffeinate -is` 并确认 PreventSystemSleep assertion 生效。
- 四项异常所属聚焦测试防系统休眠重跑：10 pass / 0 fail，58.95 秒，涵盖四问题切换、500 个 TPS 样本、CLI bad arguments、30 秒 permission review。日志 `/tmp/neant-issue02-sleep-focused.log`。
- 最终 `rtk proxy env -u NO_COLOR caffeinate -is bun run check`：格式、lint、`tsc -b`、Knip、完整测试全部通过；699 pass / 0 fail，4340 assertions，58 files，96.98 秒。日志 `/tmp/neant-issue02-awake-check.log`。

## Standards

审查固定基点 `5167ab05796d8aa4f0ae80d64ef01961ed85ee21`，独立 Standards 子代理：0 硬违规；1 项可选 Duplicated Code 建议已采纳，提醒的 latest-content 扫描抽成同一 private helper。复审通过，新增保留尾部测试也符合公开 seam、模块边界、Bun 运行时与领域命名约定。0 项未解决发现。

## Spec

独立 Spec 子代理：0 项缺失、0 项越界、0 项确定错误。自动注册、状态标记、Run 去重、resume、立即持久化和摘要相邻投影均符合要求；skills / MCP 行为维持原样。可选的保留尾部覆盖建议已采纳并复审通过：历史 todo reminder 保留原始时序，当前 reminder 紧跟摘要，后续历史工具调用记录最新更新。

审查合计：Standards 0 项未解决，Spec 0 项未解决；无已知阻塞问题。
