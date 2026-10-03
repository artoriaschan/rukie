# 02: 地基 B：工具状态进 transcript

Type: grilling
Status: open
Blocked by: None

## Question

工具产生的、需要跨 run / resume 存活的状态，怎么记进 transcript 并在恢复时重建？

用例：todo 列表、Goal（参考 deepseek-harness `goal/change` 完整快照事件 + 回放折叠）、checkpoint 快照引用、子代理结果。

需定：

- 用 Session Store 里的独立事件类型（与模型消息分离），还是嵌在 tool result 里。
- 快照（last-wins）还是增量；回放时坏记录报错还是跳过。
- 这些状态如何反馈给模型：system reminder、tool result、还是 Goal 那样留在历史里的用户消息。
- compaction 后状态是否保留、如何重新告知模型。
- 进程内易失状态（如 Goal 的 armed）与持久状态的边界原则。
- 子代理验证场景：子代理自身的 transcript 存在哪、父 transcript 记什么。
