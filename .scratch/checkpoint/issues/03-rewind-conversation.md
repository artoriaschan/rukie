# 03: 回对话与两者都回

**What to build:** `rewind` 支持 `conversation: true`：把 transcript 的 main 分支指针移到目标 user 消息 entry 的 parent（原分支保留），并在内存中按新分支重建 messages、Tool State（todo、plan、goal、checkpoint）与 compaction 状态，效果等价于对该点 resume，但不新建 Session。返回被回退的 prompt 文本。两者都回时先回代码，代码失败则对话不动。只有真实 user prompt 开 Checkpoint。见 [spec](../spec.md)"Checkpoint 锚点 / 回对话"。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 只回对话：`messages` 与 `toolState()` 立即反映新分支，发出相应状态事件（如 `tool_state_changed`、plan mode 变化）
- [ ] 文件不变；回退后继续 run 从新位置接着建 Checkpoint，可反复回退
- [ ] 两者都回：代码与对话同时回到目标；回代码失败时对话不变
- [ ] 目标在 compaction 之前也可回，新分支不含之后的摘要
- [ ] hook autorun、Goal 续跑、Stop 续跑、子代理完成通知不开新 Checkpoint，也不出现在 `checkpoints()` 中
- [ ] 返回值含 prompt 文本
- [ ] e2e 测试覆盖以上，含 resume 后回对话
