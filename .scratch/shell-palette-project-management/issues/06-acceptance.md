# 06：整体验收

Status: ready-for-agent

Blocked by: 01, 02, 03, 04, 05

**What to build:** 对整份 [spec](../spec.md) 做交付验收。复用各工单已有的验证证据，只补充被后续改动失效的部分。

- [ ] 对照 spec 的 User Stories 与 Implementation Decisions 检查实现，并完成 [ADR Coverage](../spec.md#adr-coverage) 审阅：ADR-0041 更新从 proposed 转为确认，链接与状态正确
- [ ] DESIGN.md、CONTEXT.md、ADR、README 与实现一致；zh 与 en 文案完整
- [ ] `bun run check:dev` 通过；受影响的 server、ui-node、ui-browser 测试有通过证据
- [ ] 以 `bun run dev:desktop:web --isolated` 做一次 agent-browser GUI 验收：外壳三栏与阴影、创建、信任、编辑、移除、详情卡、项目行；覆盖 Light、Dark、窄宽度、光标、hover、焦点、控制台与网络。完成后关闭浏览器会话并停止启动器
- [ ] 记录验证结果与剩余限制，所有工单与 spec 状态更新为 resolved

## Comments
