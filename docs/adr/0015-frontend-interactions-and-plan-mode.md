---
status: accepted
---

# Agent Core 发起 Interaction，Plan Mode 独立于权限模式

## 问题

Agent Core 同时服务交互式与非交互式 Frontend，不能直接操作终端，也不能在无人回应时永久挂起。规划意图与动作授权需要分别表达。

## 决定

Agent Core 通过按交互种类划分的 Frontend 回调请求权限、问题、计划评审和 MCP 授权。未提供回调时，依赖它的模型工具不暴露；Core 自身的请求取安全默认值。挂起交互随 Run 取消，晚到回复不能恢复授权。交互界面状态不写入 Transcript，结果通过对应工具消息体现。

子代理交互携带来源转发到父级 Frontend；同一界面统一排队。Headless CLI 不提供回调，沿用相同 Core 执行路径与默认结果。具体回复与取消契约见 [Agent README](../../packages/agent/README.md)。

Plan Mode 是持久化的 Session 状态，通过当前状态 reminder 引导模型；固定 System Prompt 不随模式切换重写。它不限制可用工具，也不隐含只读权限。进入规划仍需授权，退出通过计划评审；批准结束规划，修改意见保留规划，用户接管结束当前运行。子代理共享父级规划状态，不拥有独立的规划切换工具。

依据：[问题交互](../../.scratch/ask-user-question/spec.md)、[Plan Mode](../../.scratch/plan-mode/spec.md)、[MCP OAuth](../../.scratch/mcp-oauth/spec.md)。

## 备选方案

- 在 Core 中直接实现终端交互：Headless 和后续 Frontend 无法复用同一行为。
- 把 Plan Mode 作为只读权限模式：规划与 Permission Mode 耦合，规划期间的明确授权无法独立表达；Plan Mode 规格已确认采用提示约束。

## 影响

Frontend 负责显示、排队与收集回复，Core 负责取消和安全默认值。扩展交互必须同时验证缺少回调及取消行为；规划恢复遵循 [Tool State 决定](0016-tool-state-and-context-projection.md)，权限遵循 [ADR-0014](0014-permission-rules-and-project-trust.md)。
