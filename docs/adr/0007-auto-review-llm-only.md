# auto-review 只用 LLM 评审，失败转 ask

Status: accepted

`auto-review` permission mode 下，除三种模式共用的直接允许工具基线（read / glob / grep / skill / ask_user_question 直接 allow）和用户显式 `allowTools` 外，每次工具调用都发起一次 permission review：独立模型调用，输入过滤后的历史（用户指令、历史工具调用参数、project instructions、待执行调用），不含 assistant 文本和工具结果，输出 `{risk, decision, reason?}`。评审 deny、出错、超时（30s）或超长都转为向用户 ask，而不是直接拒绝；Headless CLI 照旧把 ask 当 deny。

不用静态规则（bash denylist/allowlist、cwd 路径判断）：规则永远不全，漏判给人虚假安全感，误判又会打断用户；判断 medium 风险的关键是"用户有没有明确授权这个动作和范围"，只有读得懂对话的模型能做。代价是每次需要评审的调用多一次模型请求，用可配置的 `reviewModel`（缺省回退主模型）控制成本。

参考 deepseek-harness 的 Auto review 插件（同为纯 LLM、同样的风险分级与过滤方式），但它评审失败直接拒绝；Rukie 改为转 ask，因为 TUI 有人可问，拒绝只会让 run 白白失败，安全性不变。
