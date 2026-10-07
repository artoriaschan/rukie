# 09: 当前文档、ADR 覆盖、最终审查与验收

Status: ready-for-agent
Blocked by: 08

## What to build

检查整次迁移是否符合已确认范围，删除旧路径并更新当前使用说明、领域定义与示例。完成 ADR coverage review 和一次最终 aggregate gate；本票不授权发布、Git 提交/合并或 worktree 清理。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 当前 aggregate 包含 check:ink-boundaries；vendored runtime 边界以该 AST 检查验证，不以 lint/Knip 豁免推断。依赖树、源码/测试/配置消费者没有 pi-agent-core、旧 harness 私有入口、旧 repo adapter、旧模型 loop 或旧数据兼容代码；没有引入 pi-coding-agent SDK。
- [ ] 功能覆盖表逐项对应 retained capabilities、原生行为变化、用户故事和 01–08 证据；移除仅保护已放弃语义的测试，仍保留授权与能力行为覆盖。
- [ ] CONTEXT、architecture、tech-stack、包 README、权限/hooks/MCP 和 Frontend 用法/输出示例描述已实施事实；Session Resume、Run/Turn、Tool State、Goal、Rewind 与 Job 术语映射一致。
- [ ] ADR-0024 与旧 ADR 替代关系对照最终 diff 审阅，沿用决定未被隐式覆盖；若实现改变长期取舍先修正 coverage 与决定，再闭票。
- [ ] 公开恢复、unsafe interrupted/safe replay、交互失效、Headless 结算、子 reporter、资源关闭和文件状态事务有当前代码证据，无真实用户配置被读写；沿用 dsh ink 的固定来源 diff、本地改动记录和当前公开 API，如有必要局部 runtime 修改，renderer README 与来源差异一致。
- [ ] focused checks 和性能审阅完成后运行一次 env -u NO_COLOR bun run check，实际命令、退出码、用例数、用时及限制记入本票；它包含全量 tests，不重复全量验证同一代码。
- [ ] 九张票的状态/验收和证据与结果一致，最后一票关闭的同一改动将 spec 置 resolved；未满足标准不得因时间或试验成功提前关闭。

## Testing Decisions

先 review 当前 diff、消费者与规格，补齐具体行为缺口后做聚焦回归；最后 aggregate check 为整次代码交付依据。仅改文档时运行 docs:update/check:docs、check:scratch、受影响 Markdown 格式与 git diff --check。生产或集成状态后续变化使结果失效时说明原因并重验。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：最终迁移验收针对 92d17ca1 起的已合并 dsh ink 基线；既有 merged-main 通过记录不能替代之后 durable 集成的 aggregate。
