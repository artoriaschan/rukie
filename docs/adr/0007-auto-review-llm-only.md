---
status: accepted
---

# auto-review 只用 LLM 评审，失败转 ask

## 问题

权限评审需要结合用户授权和上下文作出决定，并让交互式 Frontend 能处理评审失败。

## 决定

`auto-review` Permission Mode 对进入模型评审阶段的调用发起独立 permission review：输入过滤后的历史（用户指令、历史工具调用参数、project instructions、待执行调用），不含 assistant 文本和工具结果，输出 `{risk, decision, reason?}`。评审 deny、出错、超时或超长都转为向用户 ask，而不是直接拒绝；Headless CLI 将未获得其他明确授权的 ask 当 deny。

模型评审结合对话判断用户是否授权了动作与范围；不以自动维护的 bash denylist、allowlist 或 cwd 分类替代这种判断。代价是每次需要评审的调用多一次模型请求，用可配置的 `reviewModel`（缺省回退主模型）控制成本。

本记录保留“模型评审与失败转 ask”的决定。原有 `allowTools`、默认工具无条件放行和排斥显式规则的范围，由 [ADR-0014](0014-permission-rules-and-project-trust.md)部分替代：hooks 与用户 Permission Rule 先于模式默认值，显式 deny、ask 仍生效；只有进入模式评审阶段的调用才请求模型。当前规则、例外与匹配限制见[权限参考](../permission-rules.md)。历史需求见[权限模式规格](../../.scratch/permission-modes/spec.md)，后续约束见[权限规则](../../.scratch/permission-rules/spec.md)与[hooks](../../.scratch/hooks/spec.md)。

参考 deepseek-harness 的 Auto review 插件（同为纯 LLM、同样的风险分级与过滤方式），但它评审失败直接拒绝；Rukie 改为转 ask，因为 TUI 有人可问，拒绝只会让 run 白白失败，安全性不变。

## 备选方案

**用静态分类替代模型评审，或评审失败直接拒绝。** 原记录说明静态分类无法完整表达对话授权；评审失败直接拒绝则放弃 TUI 可向用户提问的恢复路径。显式 Permission Rule 是后续接受的授权约束，与模型评审并用。

## 影响

需要评审的调用增加一次模型请求；评审不可用时依赖 Frontend 的 Interaction，Headless CLI 将 ask 作为 deny。
