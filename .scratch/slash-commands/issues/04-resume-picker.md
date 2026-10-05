# 04: `/resume` 选择器

**What to build:** 用户在 TUI 输入 `/resume`，看到当前目录下以前的 session（标题、时间、条数、模型），选中后切换过去继续对话。见 [spec](../spec.md) 的“Session 列表与恢复”。

**Blocked by:** 03（Session 标题与 `/rename`）

**Status:** ready-for-agent

- [ ] Agent Core 导出 `listSessions({ cwd })`：基于 store `list`，返回非子 session 的 `{ id, title, titleSource, updatedAt, messageCount, model }`，按更新时间倒序
- [ ] TUI `/resume` 打开选择器（复用现有选择组件）；每行两行：标题（来源 `prompt` 时暗色）/ `时间 · 条数 · model`
- [ ] 选中后 dispose 当前 session，以 `resumeId` 重建并重新渲染对话；Esc 关闭选择器不做任何事
- [ ] 仅空闲可用（run 中被拒）；没有可恢复的 session 时提示
- [ ] Agent Core e2e（排除子 session、排序、字段）与 TUI 测试（参照 `resume.test.ts`）覆盖以上行为
