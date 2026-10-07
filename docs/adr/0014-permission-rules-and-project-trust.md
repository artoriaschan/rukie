---
status: accepted
---

# 显式权限规则先于模式默认值，项目授权受信任闸门约束

## 问题

按工具名整体放行无法表达命令、路径和域名的授权范围；项目自行提供 allow 配置还可能扩大用户授权。纯模型评审也不能替代用户写下的明确限制。

## 决定

普通工具按 hooks → Permission Rule → Permission Mode → Interaction 的固定阶段判定。规则跨来源取 `deny > ask > allow`；规则 deny 直接拒绝，ask 直接进入询问，allow 跳过模式默认值。`full-access` 只改变模式默认值，不能覆盖显式规则。模型评审仍遵循 [ADR-0007](0007-auto-review-llm-only.md)，该记录原有的 `allowTools` 和排斥显式权限规则的范围由本决定替代。

PreToolUse 改写参数后重新校验 schema，并用最终参数匹配权限规则；hook allow 不能越过规则 deny 或 ask。PermissionRequest hook 的参数改写也重新匹配规则。通过授权后的观察阶段使用不可改写执行参数的副本，Checkpoint 等能力在此记录最终目标。

用户层和项目层 deny、ask 合并；项目 allow 与 hooks 仅在 Trusted Project 生效。项目 MCP 配置要求项目受信任，或用户单独明确授权该 MCP 配置；单独授权 MCP 不等于信任项目 hooks 或 allow。provider 凭据归用户配置。退役 `allowTools`，旧设置明确报迁移错误；临时会话授权只保留于内存，按命令、文件目录、域名或工具名收窄，父子 Session 共享，Resume 后失效。

规则是应用授权机制。bash 文本匹配不能完整解析 shell，不能充当操作系统 sandbox。管理本 Session 已授权进程的 `job_list`、`job_output`、`job_kill` 保留校验与 hook、规则的 deny，但跳过再次审批；其资源范围见 [ADR-0010](0010-own-bash-tool-for-background-jobs.md)。

## 备选方案

- 保留工具级 `allowTools`：一次授权放开整个 bash 或文件工具，无法限定动作与资源。
- 让 full-access 覆盖一切限制：用户明确写下的 deny、ask 将失效。
- 直接信任项目 allow 与可执行配置：未信任仓库可以自行扩大权限或执行代码。

这些取舍来自[权限规则规格](../../.scratch/permission-rules/spec.md)和[hooks 规格](../../.scratch/hooks/spec.md)。

## 影响

新增工具与 hook 必须经过同一授权路径，改写输入不得留下旁路。配置迁移需要明确错误反馈；会话授权不能由 Transcript 自动恢复。规则语法、匹配限制与 hook 协议分别由[权限参考](../permission-rules.md)和[hooks 参考](../hooks.md)维护。
