# 07: `/btw` 侧问

**What to build:** 用户在 TUI 输入 `/btw <问题>`（run 中也可以），overlay 里流式显示一个基于当前上下文的单轮回答，不打断主 run、不进 transcript，Esc 关闭并中止。见 [spec](../spec.md) 的“侧问”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** ready-for-agent

- [ ] Session 新增 `sideQuestion(question, { signal })`：流式返回文本；空闲与 run 中都可用
- [ ] 请求：当前恢复后的上下文，剔除没有结果的 tool call，追加按 dsh-TUI `wrapSideQuestion` 包裹的 user 消息（只基于已有上下文、无工具、列出仍在执行的调用）；不带工具定义
- [ ] 不写 transcript、不触发 hooks 与 reminder、不发 Session 事件；signal 能中止
- [ ] TUI overlay：流式显示问题与回答，Esc 关闭并中止；再发侧问中止前一个；空参数只提示用法
- [ ] 测试工具：`controlledModel` 把侧问调用分到独立队列（若 03 已有分流机制则复用）
- [ ] Agent Core e2e 与 TUI 测试覆盖以上行为
