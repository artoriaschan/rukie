# 06：整体验收

Status: ready-for-agent

Blocked by: 02, 03, 04, 05

**What to build:** 对整个会话侧栏重构做交付验收，确认布局、交互与文档一致后关闭 spec。

- [ ] 按 DESIGN.md layout preservation gate 重跑 shell、transcript、dock、composer 与侧栏几何用例，未授权差异全部修复
- [ ] 使用 agent-browser 在 `bun run dev:desktop:web --isolated` 下验收侧栏三分类、行尾操作、右键与更多菜单、重命名、归档、永久删除与搜索浮层；Light、Dark 与窄宽度截图；检查 cursor、hover、焦点、控制台与网络错误
- [ ] 按验证记录规则运行受影响测试与 `bun run check:dev`，记录结果
- [ ] 完成 spec 的 ADR Coverage 审阅，确认 CONTEXT.md、DESIGN.md 与实现一致
- [ ] 关闭本票并将 spec 设为 resolved
