# 04: `/resume` 选择器

**What to build:** 用户在 TUI 输入 `/resume`，看到当前目录下以前的 session（标题、时间、条数、模型），选中后切换过去继续对话。见 [spec](../spec.md) 的“Session 列表与恢复”。

**Blocked by:** 03（Session 标题与 `/rename`）

**Status:** resolved

- [x] Agent Core 导出 `listSessions({ cwd })`：基于 store `list`，返回非子 session 的 `{ id, title, titleSource, updatedAt, messageCount, model }`，按更新时间倒序
- [x] TUI `/resume` 打开选择器（复用现有选择组件）；每行两行：标题（来源 `prompt` 时暗色）/ `时间 · 条数 · model`
- [x] 选中后 dispose 当前 session，以 `resumeId` 重建并重新渲染对话；Esc 关闭选择器不做任何事
- [x] 仅空闲可用（run 中被拒）；没有可恢复的 session 时提示
- [x] Agent Core e2e（排除子 session、排序、字段）与 TUI 测试（参照 `resume.test.ts`）覆盖以上行为

## Answer

Agent Core 的 `listSessions({ cwd, homeDir?, store?, settings? })` 读取原生列表、名称、消息统计与当前 main branch 的 Tool State；不维护平行索引、不重建原生文件路径。JSONL 使用原生 `modifiedAt`，其他 store 回退到最新 entry timestamp / createdAt；模型优先保存的选择，其次最后 assistant 的 provider/model，再回退配置。cwd 与 `createSession` 同样使用 `resolve`，保留现有 symlink 拼写身份。排除 `parentSessionId` 和旧版 `legacyParentSessionPath`。

名称和来源作为只读显示值：保存的名称不变；真正无名称的会话显示 id、来源显示 `prompt`，不会回写合成值。无回答、无模型选择且没有配置时模型显示空串。原生统计包含所有存储的 message entry。当前会话仅由 frontend 从 picker 排除，Core 仍会列出。

同一 injected store 在 Run / 标题写入期间原本报 `Session is already open`，公开行为测试复现后加入 store 概念内的 WeakMap reader 能力登记，借用 Session 既有的串行 lease；dispose 注销。没有 metadata 缓存，普通读取的 handle 在 finally 关闭，标题模型等待仍不占用 lease。

TUI 复用 ListItem / HintLine 和既有 replaceSession：两行有界焦点窗口，prompt 来源暗色，中英文提示，40×12 使用紧凑输入。Esc 仅关闭列表；选中后重新绑定并恢复对话、标题和模型，无额外模型请求，后续 prompt 使用恢复的上下文。空列表提示，运行中拒绝。

验证：公开入口 `session-list.test.ts` 与 `resume-picker.test.ts` 共 9 项通过。合入工单 06 的整合 tip `604e0ef` 后，列表、标题、模型、手动/自动 compaction、hooks、上下文报告及既有 TUI resume / slash / settings 共 **98 pass / 0 fail / 593 assertions**（`env -u NO_COLOR bun test`，13 files）；oxfmt / oxlint / tsc -b / knip 全通过。未运行单工单全量，整个 spec 的精确整合 HEAD full check 由 root 完成交付。

最终完整检查的关联同步纠正：旧的 picker 暂态失败发生在第二次 `/resume` 后，只等 `Resume session` loading 标题便发送 Enter；读取未完成时 `busy` 守卫按设计忽略 Enter。公开 `start()` 测试通过注入的 SessionStore 暂停第二次 list，确定复现旧顺序即使之后列表完成仍不切换。测试改为等待可选择的 `❯ Stored session` 行再发 Enter，窄终端首次打开也等待真实焦点行。生产行为和超时未改。Red/green 日志：`/tmp/neant-slash-resume-readiness-red.log` / `/tmp/neant-slash-resume-readiness-green.log`。

同步纠正验证：title、context、resume、side-question 和 Core session-list 共 5 个受影响文件连续 5 次均为 27 pass / 0 fail / 160 assertions（合计 135 pass / 0 fail / 800 assertions），日志 `/tmp/neant-slash-readiness-repeat-{1..5}.log`；oxfmt、oxlint、tsc -b、knip 和 git diff --check 通过。整个 integration 的 final full check 由 root 执行。
