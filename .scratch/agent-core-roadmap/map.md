Labels: wayfinder:map

# Map: Agent Core 能力路线图

## Destination

一份 Agent Core 能力路线图：要补哪些能力、按什么顺序、彼此怎么依赖，以及每项进入 `/grill-with-docs` 前必须先定的跨项决策。地图不深入单项实现；每项走出地图后各自 `/grill-with-docs` → `/to-spec`。

## Notes

- 定位：Neant 是用户的第二工具 / 学习实验项目，不替代日常主力。"完整"的取舍以用户日常是否用得上为准，Claude Code 本地核心功能作参考清单。
- 范围：Agent Core 加 frontend 必需交互面（TUI 呈现、Headless CLI 降级）。server 与桌面端不在内。
- 排序原则：先地基（被多项依赖的公共机制），再按学习价值（架构难度大的先）。sandbox 优先级最低。
- 地基工单需写明子代理如何使用该地基，作为验证场景。
- 每个 grilling 工单调用 `grilling` 与 `domain-modeling`；遵守 `CONTEXT.md` 术语与 `docs/adr/`。
- 已在 charting 中定下（详见各工单 Question 前提）：Slash Command 属 frontend，Agent Core 只暴露能力 API（已入 `CONTEXT.md`）；Goal 续跑归 Agent Core，参考 deepseek-harness `packages/goal`；goal 与 todo 独立。
- 参考实现：deepseek-harness（`~/Workspaces/agent/deepseek-harness`）、dsh-TUI（`~/Workspaces/agent/dsh-TUI`）。

## Decisions so far

- [子代理参考实现调研](issues/04-research-subagent-prior-art.md): 三者都只回传最终文本、子 transcript 为带 parent 链接的独立 JSONL、进度走事件；分歧在权限（Claude Code 冒泡给用户 vs harness 固定 never 自动拒绝）、嵌套深度（3 vs 1）、定义方式（具名 markdown vs provider 配置）；dsh-TUI 运行时即 harness 包
- [权限规则 / hooks / checkpoint 参考实现调研](issues/05-research-rules-hooks-checkpoint-prior-art.md): CC/Codex 都是固定顺序 hooks（可改写）→ 规则（deny>ask>allow 取最严、跨层合并、复合命令拆分逐段判）→ 审批 → 执行 → post，hook allow 绕不过规则；DSH 无规则只有 sandbox×approval preset、hooks 不可改写；checkpoint 仅 CC 现存（每 prompt、只跟踪文件工具不含 bash），Codex 整树 ghost 快照已移除，DSH 影子 git 只作 diff
- [地基 A：Agent Core → frontend 交互通道](issues/01-interaction-channel.md): 每种交互一个回调 + 内部共享 helper；无回调时先去工具、再取安全默认值；交互内拒绝不影响 run，run 中止以取消结束；不进 transcript；子代理经顶层回调转发并带 origin

## Not yet specified

- 子代理的并发与上下文隔离细节（并行数、取消传播、token 计量归属），等子代理工单定了地基用法后再拆。
- 最终排序与 handoff：所有能力工单定完后，汇总依赖图、给出实现顺序。

## Out of scope

- web search：需选搜索服务商与管理 API key，用户未纳入本轮。
- multi-edit / apply_patch：edit 足够，成瓶颈再议。
- MCP resources / prompts：极少 server 使用。
- server 与桌面端。
