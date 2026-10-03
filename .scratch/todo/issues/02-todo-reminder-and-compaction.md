# 02: todo reminder 与 compaction 后重注入

**What to build:** 清单还有未完成项时，模型在新 run 开始时经 system reminder 看到当前清单；compaction 之后同一 run 的下一 turn 立即重新看到它。全部完成或为空时不打扰模型。

**Blocked by:** 01（`todo_write` 写入并在 resume 后恢复）

**Status:** ready-for-agent

参考：[spec](../spec.md)「Tool State 地基」反馈给模型 / compaction 后两条，「`todo_write` 工具」reminder 渲染。

- [ ] Tool State 定义支持可选 reminder 渲染；带渲染的 Tool State 自动成为 `ReminderSource`（source 即 name）
- [ ] `todo` 渲染：非空且有未完成项时输出带状态标记的清单 + 一句"按需更新"提示，否则 undefined
- [ ] 走现有去重：每 run 开始、内容变了才注入；resume 后首个 run 照常注入
- [ ] compaction 结束时立即把所有 Tool State 的当前 reminder 追加到摘要之后并写入 transcript
- [ ] Tool State reminder 去重只比较最后一次 compaction 之后的消息
- [ ] 不做催促 reminder；不改现有 skills / mcp reminder 行为

测试（seam 1）：

- [ ] 有未完成项 → 下一 run context 含 todo reminder；全部完成 / 为空 → 不含；内容未变 → 不重复
- [ ] resume 后首个 run 含 todo reminder
- [ ] 触发 compaction 后，同 run 下一 turn context 中摘要之后紧跟 todo reminder
