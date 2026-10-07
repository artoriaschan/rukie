# 05: transcript 中的 `todo_write` 工具卡

**What to build:** TUI 用户在 transcript 里看到 `todo_write` 调用显示为"待办清单"加一行进度摘要和进行中项，回看历史时每张卡反映当时那一版清单。

Blocked by: 01（`todo_write` 写入并在 resume 后恢复）

Status: resolved

参考：[spec](../spec.md)「TUI」transcript 工具卡；dsh-TUI `src/dsh-adapter/channel/transcript.ts`；Neant 现有 `ask_user_question` 摘要做法。

- [x] 工具名显示"待办清单"（en: `TodoWrite`）
- [x] 摘要 `todos ✓ done/total`，其后每个 in_progress 项 `● content`，整卡最多 4 行
- [x] 从该次工具调用参数渲染，不读 Tool State
- [x] 工具出错时按现有错误卡呈现
- [x] 不做前后快照 diff
- [x] 中英文案

测试（seam 2）：

- [x] 摘要与 4 行上限
- [x] 多次写入时各卡显示各自那一版
- [x] 错误调用呈现
- [x] 中英文案

## Comments

2026-10-04：使用 `/Users/artorias_chan/.agents/skills/implement/SKILL.md`，按 `tdd` 已约定 seam 2（公共 `start` + faux 模型 + 终端输出）完成。仅实施 05 transcript 工具卡，未引入前后快照 diff。

实现证据：

- `toolEntry` 同时服务 live 完成与 resume 回放；成功的 `todo_write` 从该次工具调用参数生成摘要，不读取当前 Tool State。后续改写或清空清单后，历史各卡仍保留当时的独立版本。
- frontend 双语字典提供标题“待办清单” / `TodoWrite` 与 `todos ✓ done/total` 计数。按全量计数，进行中项依原顺序显示 `● content`，条目内换行压成单行并沿既有工具卡 truncate 宽度。
- 整卡四行上限包含工具名：标题一行、计数一行、最多两条进行中项。已核对实际 dsh-TUI `src/dsh-adapter/channel/transcript.ts` 的计数与进行中摘要，按本 issue 的整卡四行约束控制预算。
- 重复内容等执行错误与非法状态等参数校验错误均沿既有错误卡，live / resume 一致；失败卡不生成成功计数摘要。

验证证据：

- 首片中英文公共黑盒红测正确失败于缺少本地化标题；实现后通过，覆盖计数、四行上限、换行压缩、80 列长文本截断与后续 assistant 行位置。
- `rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/e2e/todo-summary.test.ts`：6 pass / 0 fail，32 assertions。覆盖双语摘要与行数、连续更新与清空后各卡独立版本的 live / resume 输出，以及重复内容和 schema 错误卡的 live / resume。
- `rtk proxy bunx tsc -b`：通过。
- `rtk proxy env -u NO_COLOR caffeinate -is bun run check`：exit 0，format / lint / tsc / Knip / 完整测试全部通过，715 pass / 0 fail，4431 assertions，60 files，100.27 秒。完整日志 `/tmp/neant-todo-issue05-final-check.log`。
- 独立 Spec reviewer 复跑上述聚焦用例：6 pass / 0 fail。

## Standards

固定审查基点 `b145768e4aa87a9af8fe0fea7e5121b3da684a93`，审查实现提交 `a013622c0b889d99c62656941083500dcaa53d1a`。独立 Standards 子代理：0 项硬性违规，0 项需整改 Fowler smell。新增文案归属 TUI 字典；screen 层共用 live / resume 摘要转换；测试通过约定公共 seam 验证，无私有函数或内部状态断言。

## Spec

独立 Spec 子代理：0 findings。双语标题、计数、进行中项、整卡四行、调用参数来源、原有错误卡与无快照 diff 均符合 05/spec；未发现缺失、部分实现、范围扩张或规格实现错误。

审查合计：Standards 0 未解决，Spec 0 未解决。

实现提交：`a013622c0b889d99c62656941083500dcaa53d1a`（`feat(tui): summarize todo transcript cards`），已提交当前 main。本地 Markdown tracker 已勾选验收项并设置 done，验证与审查证据随工单提交。
