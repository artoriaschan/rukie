# 09: 当前文档、ADR 覆盖、最终审查与验收

Status: claimed
Blocked by: none

## What to build

检查整次迁移是否符合已确认范围，删除旧路径并更新当前使用说明、领域定义与示例。完成 ADR coverage review 和一次最终 aggregate gate；本票不授权发布、Git 提交/合并或 worktree 清理。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] 当前 aggregate 包含 check:ink-boundaries；vendored runtime 边界以该 AST 检查验证，不以 lint/Knip 豁免推断。依赖树、源码/测试/配置消费者没有 pi-agent-core、旧 harness 私有入口、旧 repo adapter、旧模型 loop 或旧数据兼容代码；没有引入 pi-coding-agent SDK。
- [x] 功能覆盖表逐项对应 retained capabilities、原生行为变化、用户故事和 01–08 证据；移除仅保护已放弃语义的测试，仍保留授权与能力行为覆盖。
- [x] CONTEXT、architecture、tech-stack、包 README、权限/hooks/MCP 和 Frontend 用法/输出示例描述已实施事实；Session Resume、Run/Turn、Tool State、Goal、Rewind 与 Job 术语映射一致。
- [ ] ADR-0024 与旧 ADR 替代关系对照最终 diff 审阅，沿用决定未被隐式覆盖；若实现改变长期取舍先修正 coverage 与决定，再闭票。
- [ ] 公开恢复、unsafe interrupted/safe replay、交互失效、Headless 结算、子 reporter、资源关闭和文件状态事务有当前代码证据，无真实用户配置被读写；沿用 dsh ink 的固定来源 diff、本地改动记录和当前公开 API，如有必要局部 runtime 修改，renderer README 与来源差异一致。
- [ ] focused checks 和性能审阅完成后运行一次 env -u NO_COLOR bun run check，实际命令、退出码、用例数、用时及限制记入本票；它包含全量 tests，不重复全量验证同一代码。
- [ ] 九张票的状态/验收和证据与结果一致，最后一票关闭的同一改动将 spec 置 resolved；未满足标准不得因时间或试验成功提前关闭。

## Testing Decisions

先 review 当前 diff、消费者与规格，补齐具体行为缺口后做聚焦回归；最后 aggregate check 为整次代码交付依据。仅改文档时运行 docs:update/check:docs、check:scratch、受影响 Markdown 格式与 git diff --check。生产或集成状态后续变化使结果失效时说明原因并重验。

## Verification

2026-10-08：从已独立集成08 `b6c4becc3cc0fe58c7c2eb24b5e3520d64081fa3` 建立新工作树 `/tmp/rukie-pi-durable-09`／`codex/pi-durable-09-delivery-docs`，frozen install exit0。Status 保持 claimed，整体 code review／修正／最终 aggregate 和 spec 关闭尚待协调者完成。

[覆盖表](../coverage.md)逐项保留46条原文、13项retained capabilities、01–08公开测试／源码／Verification与限制。包含07实际Goal三crash窗口、真实input预算和两项组合报告RED修正，以及08实际SIGINT130／SIGTERM143、SessionStart初始化取消、真实Hook PID清理与failed reader cleanup。文档审计不重新运行这些集合，不将historical failed package改写为PASS。

当前文档更新：AGENTS的Harnessreuse指向0024，保留CLAUDE相对symlink；architecture按原生Generation／ToolTask／Submission与请求结算描述，移除旧Loop／AgentTool／dispose／conversation_reconciled和已删除能力目录。CONTEXT、AgentREADME、Hooks、MCP、权限与tech-stack区分close／abort、initializationSignal、完整Transcript／activehead与OSJob；Frontend ownerREADME沿用08已验证的输出、signal与终端合同，没有新增未编译的可运行TS示例。

源／测试／脚本／package／lock／Knip非文档扫描未发现pi-agent-core、pi-coding-agent、JsonlSessionRepo、MemorySessionRepo、AgentTool、Agent.state、beforeToolCall、旧dispose与旧事件消费者；根override和bun.lock将Pi实际解析固定1.0.4、TypeBox1.3.27。脚本 `check` 调用 `check:dev`，后者包含真实AST `check:ink-boundaries`。没有为消除历史ADR术语而删除实际授权覆盖；本次无生产接口或测试变化。

ADR Coverage：逐项核对0024完整／部分替代与0015扩展，更新0002／0003／0010／0016过时“尚未实施”开头；0009／0015／0017／0018既有历史替代说明保留。0011能力ownership持续有效，清除过时迁移进度；0023保留分发／许可历史范围，明确之后接受的0013。current09审计未发现新增长期取舍，最终整体diff review仍待执行。

固定来源manifest124个文件均存在，SHA256实际39修改，README37→39并补kitty-graphics／terminal-querier两项；相对92d17ca1的五文件diff与README未压缩RGBA／4096分片／codec-owned sharp说明一致，08没有ink生产修改。仅修订inventory，不改renderer实现。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：最终迁移验收针对 92d17ca1 起的已合并 dsh ink 基线；既有 merged-main 通过记录不能替代之后 durable 集成的 aggregate。

2026-10-08：当前准备提交仅文档与票据／coverage；最终review、唯一aggregate、09/spec同时resolved及cleanup仍待后续交付。

当前验证：`bun run docs:update`／`bun run check:docs`（46维护Markdown）／`bun run check:scratch`／`bun run check:ink-boundaries` 全部exit0；修改Markdown oxfmt与`git diff --check`通过。目标故事原文46条／retained13项、coverage本地链接、manifest124文件与39修改清单、CLAUDE→AGENTS symlink分别核对。`codex/pi-durable-migration` 合并为 Already up to date；无生产／测试变更，无package或aggregate执行。

2026-10-08 独立文档／audit merger：审阅 `7870851e` 相对08集成 `b6c4becc` 的17个文档／tracker文件，核对46条故事原文与顺序、13项保留能力、229个仓库内覆盖引用目标、ADR-0024的完整／部分替代和继续有效的ownership／授权／终端决定。重新计算manifest124文件与39个实际SHA256差异，和renderer README清单逐项相符；CLAUDE保持相对AGENTS symlink，当前非文档依赖／消费者扫描无旧引擎入口。纠正architecture一处历史预算表述：普通provider响应也结束本次共享文件提醒预算，Compaction只有实际提交才触发额外重置；依据Session.afterResponse与已提交Compaction观测，不改执行行为。已独立合并当前文档／audit，09与spec仍claimed，整体两轴代码审查、修正及唯一隔离HOME aggregate尚未执行；不将本次文档验收写成全部AC或全量测试通过。集成docs／tracker、受影响Markdown格式、AST边界与diff检查通过。首次集成AST检查因现有TypeScript模块缺少ScriptTarget而exit1；隔离HOME运行frozen install（315 packages，2.30s）刷新锁定依赖后，实际TypeScript6.0.3与ScriptTarget.Latest解析正常，AST检查exit0，未改脚本或生产源码。未运行package/full。

2026-10-08 最终代码审查修正（仍 claimed）：独立 [Standards／Spec 报告](../review.md) 分开保留，review范围92d17ca1→72631e03。一个新 implementer worktree集中处理三项发现：Session自有同版本文档schema校验（实际cold RED）、root／child Stop持久化续跑budget归hooks统一策略、重复provider调用ID的chronologicalToolView（实际read→read→bash RED）。公开父子/冷恢复/历史asOf复制/稳定DocID和no-side-effect fixture及受影响Checkpoint／Hook／观测110 PASS、617 assertions、7.73s；有效nativepending请求／Goal／Session恢复另26 PASS、140 assertions、2.38s；当前check:dev exit0（format／lint／types／Knip／tracker／46 Markdown／ink AST，`/tmp/pi-durable-final-findings-static.log`），docs／tracker／目标格式／diff检查通过。没有引入SDK私有patch、第二恢复引擎或renderer修改，没有package／aggregate运行；09/spec不因聚焦通过而提前关闭。

2026-10-08 三项最终review correction已独立集成：`28acbdca` 的Session-owned十文档校验、共同Stop continuation policy及重复provider ID的历史ToolView修正均获原Standards／Spec reviewer recheck PASS；独立merger核对current/root/child/historical-copy边界、原生fault传播及实际公开证据后接纳。完整独立轴报告和merger记录见 [review](../review.md)。当前集成docs／tracker／格式／diff通过，09/spec仍claimed；协调者最终隔离HOME aggregate仍待执行，未把focused结果写成全仓PASS。
