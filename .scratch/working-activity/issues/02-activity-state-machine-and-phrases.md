# 02: 状态机与中文文案池

Status: ready-for-agent

**What to build:** `apps/neant-tui/src/screens/chat/activity/` 下的纯函数状态机 `reduce(state, event, now)` / `render(state, now) → { phase, line, nextWakeAt }`，和从 dsh-working-activity 拷贝的中文文案池，见 spec ④ 节。原包的 turn 对应 Neant 的 Run。这张只做纯逻辑和单元测试，不接 UI。

**Blocked by:** —

- [ ] `phrases.ts` 文件头保留 BSD-3-Clause 全文，并注明来源路径与版本 0.5.1；删掉 en 和没有输入来源的池
- [ ] 阶段迁移 `idle → waiting → thinking ⇄ tool → done`，事件对应关系按 spec 实现
- [ ] 文案按 `runStartedAt` 加 4s slot 确定性选取；30/60/300s 分档；深夜、周末、节日、稀有 1/150
- [ ] 工具动词在 start 时抽一次；`detailFor` 取参数并截到 40 列；连击 `工具xN`；刚完成的工具保留 2.5s；首次调工具时显示开场文案 2.5s
- [ ] 自述 `⏵` 提取，5s 后过期；打断接梗和 compaction 插话显示 6s；审批卡住原因优先
- [ ] done 汇总 `齐活 · N 工具 · 想Xs 干Ys · 🔥 12.3k`
- [ ] `nextWakeAt` 取整秒、换条边界、过期三者中最早的一个
- [ ] 随机源可注入，测试用假时钟
- [ ] `bun run check` 全绿
