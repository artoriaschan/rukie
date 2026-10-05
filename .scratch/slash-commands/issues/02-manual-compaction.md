# 02: 手动 compaction

**What to build:** 用户在 TUI 输入 `/compact` 或 `/compact <侧重点>`，立刻压缩上下文、不看 80% 阈值；侧重点只影响这一次摘要。进度与结果通知与自动 compaction 一致，hooks 能区分手动触发。见 [spec](../spec.md) 的“手动 compaction”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** ready-for-agent

- [ ] Session 新增 `compact({ instructions? })`：仅空闲，run 中抛错；没有可压缩内容时抛错；与自动 compaction 共用压缩路径
- [ ] `instructions` 透传给 pi compaction 的 `customInstructions`，出现在摘要请求里，不进 transcript
- [ ] `compaction_start` / `compaction_end` 增加 `trigger: "auto" | "manual"`（shared 事件 breaking change）
- [ ] PreCompact / PostCompact hook 输入 `trigger` 取 `manual` / `auto`；手动时带 `custom_instructions`（无指令为空串）；PreCompact 阻断时 `compact()` 抛出带 hook 原因的错误
- [ ] 压缩后 SessionStart(`compact`) hook 与 reminder 重注入沿用自动路径；resume 后上下文与压缩结果一致
- [ ] TUI `/compact [指令]` 接入；run 中被拒；错误以通知显示
- [ ] Agent Core e2e（参照 `compaction.test.ts`、`compaction-hooks.test.ts`）与 TUI 测试覆盖以上行为
