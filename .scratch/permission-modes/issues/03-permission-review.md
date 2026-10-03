# 03: Permission Review（auto-review 评审）

Status: ready-for-agent

**What to build:** `auto-review` 模式下，非只读且未命中 `allowTools` 的工具调用先经一次 Permission Review：安全的直接执行，有风险或评审失败的转为 ask 并附评审理由。Headless CLI 下有风险的即 deny。见 spec Implementation Decisions 的 review 模块与 session 节，以及 ADR-0007。

**Blocked by:** 01

- [ ] 新 review 模块（Agent Core 内独立概念目录），复用 session 的 `streamFn`，模型取 `reviewModel` 否则主模型，`temperature: 0`
- [ ] 评审输入：cwd、project instructions、最近 compaction 之后的过滤历史（user 消息 + 历史工具调用名与参数，不含 assistant 文本 / thinking / tool result）、待执行调用（名称、description、参数 schema、实参）
- [ ] 固定 review policy：low 必须 allow；medium 仅在用户明确授权动作、目标与范围时 allow；high 一律 deny
- [ ] 严格 JSON 解析；非法形状、provider 错误、30s 超时、截断后仍超长（上限为评审模型上下文窗口一半，旧历史先截）均视为失败 → ask
- [ ] allow → 执行；deny / 失败 → ask，`PermissionAskRequest` 带 `mode` 与 `reason`
- [ ] 用户拒绝后模型只看到"用户拒绝"类结果，不含评审理由
- [ ] abort 取消进行中的评审，该调用按 deny；同 turn 多调用并发评审
- [ ] `permission_review` 事件（start / end，end 带 risk、decision、reason），stream-json 输出
- [ ] 评审 token 不计入 context_usage
- [ ] Agent Core e2e 覆盖以上行为（fake model 按 system prompt 区分评审请求与主 turn）
