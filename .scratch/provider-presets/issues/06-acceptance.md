# 06：集成验收、文档同步与手动验收清单

Status: ready-for-agent

Blocked by: 05

**What to build:** 完成本 spec 的集成验证、文档一致性检查与 ADR Coverage 复核，并为用户准备真实接口的手动验收清单。

- [ ] 按 [验证记录](../../../docs/testing.md#验证记录与增量复验)汇总 01–05 的证据，只重跑失效的部分；`bun run check:dev`
- [ ] 桌面包级验收按 AGENTS.md 的复用规则执行：已有包级证据有效时不重跑
- [ ] GUI 浏览器验收：`bun run dev:desktop:web --isolated`，覆盖 P02 目录、DeepSeek 创建、协议切换、自动保存、开关、图标三处展示和模型弹窗几何；截取 Light、Dark 和窄屏截图；检查 console 与 network；验证键盘焦点与光标
- [ ] 核对 CONTEXT.md、ADR-0038、ADR-0037、DESIGN.md、`docs/tech-stack.md` 与实现是否一致；`bun run docs:update` 与 `bun run check:docs`
- [ ] 完成 spec 的 ADR Coverage 复核，然后关闭工单和 spec
- [ ] 在 spec Comments 中列出用户手动验收清单：DeepSeek 三个变体 × 一次工具调用 × 两轮对话 × `automatic` 与 `high` 两档，重点检查 Anthropic 的 adaptive thinking 和 Responses 的多轮推理连贯性；记录为待用户验收，不计入已验证项
- [ ] 推送分支并创建 PR，报告 CI 实际状态

## Comments
