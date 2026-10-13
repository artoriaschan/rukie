# 05：整体验收

Status: ready-for-agent

Blocked by: 01, 02, 03, 04

**What to build:** 完成 spec 的整体验收与交付。

- [ ] 按 [docs/testing.md](../../../docs/testing.md#验证记录与增量复验) 汇总各票验证记录，只补跑失效的证据
- [ ] `bun run check:dev`、受影响包测试与 `bun run test:desktop`（未被覆盖时）
- [ ] agent-browser GUI 验收：创建多目录 Project、信任确认、切换主目录、移动 Session；Light、Dark 与窄宽度截图，检查 cursor、hover、焦点与控制台错误
- [ ] 完成 spec 的 ADR Coverage 审阅，填入 ADR 编号与链接
- [ ] 关闭全部工单与 spec，记录本地验证结果与 CI 待验收状态
