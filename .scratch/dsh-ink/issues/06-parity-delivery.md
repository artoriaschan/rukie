# 06: 回归验收、文档与移除旧 renderer

Status: ready-for-agent
Blocked by: 04, 05
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

完成全部 spec 的交付 gate。应用行为以 ADR-0006 与 pinned dsh-TUI 为准；保留公开行为覆盖，删去依赖旧实现的无效 unit tests，不删除仍有效的产品验收。

- [ ] 完整移除旧 renderer/parser/selection/scroll/layout helpers 与旧 API/config/import，确认只有新 render path；ink/index.ts 没有兼容 facade
- [ ] 注入终端验证尺寸/窄屏、resize reading position、bottom follow、copy selection/word/line/scroll、hit target、modal focus、pointer/wheel/key/paste、terminal restore/errors/signals
- [ ] 验证多个渲染根 selection/search/退出写流隔离、真实 sixel/Kitty、graphics fallback/裁切/遮挡/预算/释放，以及 ADR-0012 模块边界
- [ ] 审计每个 >1s focused case，消除可避免真实等待；记录必须保留的进程/SDK timing 理由；final full check 仅在最后变更及 focused pass 后执行一次
- [ ] 更新 AGENTS/architecture/ink README/tech-stack 和受影响 owning docs，ADR13 accepted 与 ADR5 superseded 已由 spike 证据决定；核对链接、版本与实际行为
- [ ] integration branch code-review 的 actionable findings 通过一个实现子代理修复；必要时重复受影响验证，记录原因
- [ ] `env -u NO_COLOR bun run check` 通过，resolve 最后一张票与 spec 同一提交，记录当前证据，清理 rollout-owned 工单 worktrees
