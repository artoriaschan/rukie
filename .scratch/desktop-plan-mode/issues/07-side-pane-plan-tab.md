# 07：Side Pane 与计划标签

Status: ready-for-agent

Blocked by: 05, 06

**What to build:** 做一个最小可用的 Side Pane（C44），用来查看完整计划。几何以 rukie.pen 的 `lCPYE` 和 H23 为准。

- [ ] 按 DESIGN.md 的 Side Pane 合同实现右侧独立框架：12px 圆角，4px 间距，独立标签栏。打开后会话区左移，关闭后恢复居中。
- [ ] C20 标签栏：只支持「计划」这一种标签。× 关闭单个标签，`panel-right-close` 关闭整个 Side Pane。重复打开同一份计划时聚焦已有标签。
- [ ] 计划标签的正文是完整的 Markdown，可以滚动，支持下载和复制。
- [ ] 入口：C40 的「展开」和 C41 的计划卡。打开时同时关闭 C41。
- [ ] Side Pane 本身不持久化；会话恢复后，可以从 Transcript 重新打开计划。
- [ ] 补全 zh/en 文案。
- [ ] DESIGN.md：补充 C44 和最小 Side Pane 的规则。
- [ ] Chromium 测试：
  - 两个入口都能打开 Side Pane
  - 标签复用、关闭标签、关闭面板
  - 会话区左移与恢复
  - 窄宽度下的表现
  - Light/Dark 两种主题
- [ ] 全部完成后用 agent-browser 验收一次，覆盖 H19–H23 的流程，使用 loopback fake provider。
