# 02: 状态机与中文文案池

Status: resolved

**What to build:** `apps/neant-tui/src/screens/chat/activity/` 下的纯函数状态机 `reduce(state, event, now)` / `render(state, now) → { phase, line, nextWakeAt }`，和从 dsh-working-activity 拷贝的中文文案池，见 spec ④ 节。原包的 turn 对应 Neant 的 Run。这张只做纯逻辑和单元测试，不接 UI。

**Blocked by:** —

- [x] `phrases.ts` 文件头保留 BSD-3-Clause 全文，并注明来源路径与版本 0.5.1；删掉 en 和没有输入来源的池
- [x] 阶段迁移 `idle → waiting → thinking ⇄ tool → done`，事件对应关系按 spec 实现
- [x] 文案按 `runStartedAt` 加 4s slot 确定性选取；30/60/300s 分档；深夜、周末、节日、稀有 1/150
- [x] 工具动词在 start 时抽一次；`detailFor` 取参数并截到 40 列；连击 `工具xN`；刚完成的工具保留 2.5s；首次调工具时显示开场文案 2.5s
- [x] 自述 `⏵` 提取，5s 后过期；打断接梗和 compaction 插话显示 6s；审批卡住原因优先
- [x] done 汇总 `齐活 · N 工具 · 想Xs 干Ys · 🔥 12.3k`
- [x] `nextWakeAt` 取整秒、换条边界、过期三者中最早的一个
- [x] 随机源可注入，测试用假时钟
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：完成屏幕私有 activity 纯逻辑模块及中文文案池，保留 BSD-3-Clause 全文和 0.5.1 来源；未接 UI。`createActivity()` 初始化，`reduce(state, event, now, random?)` 注入随机源，`render(state, now)` 返回 phase、line、nextWakeAt。
- 14 个状态机测试覆盖阶段迁移、分档与确定性、工具与并行完成、参数显示列、自述和插话过期、审批优先、节日/周末/深夜/稀有文案、跨 Turn Run 汇总及唤醒边界。
- 双轴审查：Standards 无违规，工具片段去重建议已处理；Spec 发现的槽内跨 30 秒提前换条已修复并复验，分档以槽起点为准（30 秒档从 32 秒槽开始）。
- 验证：`rtk proxy env -u NO_COLOR bun run check` 通过；格式、lint、类型检查、knip 全绿，259 tests passed，0 failed。
