# 07: Skills

**What to build:** agent 能发现并使用符合 Agent Skills 规范的 skill。

- **发现**：在用户级和项目级的 `.neant/skills`、`.claude/skills`、`.agents/skills` 中查找（使用 pi 的 `loadSkills`）。重名时项目级优先；格式有问题的 skill 跳过并给出警告。
- **注入**：skills 的名称和描述列表通过 System Reminder 注入，resume 时如果列表有变化，补发增量。
- **加载**：模型通过 `skill` 工具（属于只读工具，默认放开）按名称加载正文。
- **Skill Invocation**：用户在 prompt 开头写 `/name` 时，对应 skill 的正文作为 reminder 附在这条消息上，用户原话保持不变；找不到对应 skill 时，prompt 按普通文本原样发送。

**Blocked by:** 04, 06

**Status:** ready-for-agent

- [ ] 六个发现路径都能生效，重名时项目级优先，坏掉的 skill 只产生警告
- [ ] `skill` 工具加入只读集合，能按名称返回正文；名称不存在时返回 `isError`
- [ ] skills 列表作为 06 增量机制的一个来源，列表变化时 resume 会补发
- [ ] `/name` 展开正确；`/不存在的名字`（例如以 `/` 开头的路径）原样发送
- [ ] Seam 1 测试覆盖以上所有行为
