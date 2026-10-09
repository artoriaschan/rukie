# 10: wire 协议消息清单

Type: grilling

Blocked by: 05, 06

Status: needs-triage

## Question

在复用 SessionEvent 的前提下，客户端与 server 之间具体有哪些消息：项目与 Session 的列举、新建、恢复；run、steer、abort；Interaction 请求与响应的关联 ID；重连时的 snapshot 与挂起 Interaction 补发；多 Session 在单条 WS 上的复用还是一 Session 一连接？现有 stream-json 需要做哪些破坏性修改？Interaction 回调在 `createSession` 时固定，server 的桥接回调与 `InteractionIdentity` 是否足以作关联 ID，见 [12](12-research-agent-core-in-server.md#answer)。
