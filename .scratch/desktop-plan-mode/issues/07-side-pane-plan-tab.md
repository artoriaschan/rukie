# 07：Side Pane 与计划标签

Status: claimed

Blocked by: 05, 06

**What to build:** 做一个最小可用的 Side Pane（C44），用来查看完整计划。几何以 rukie.pen 的 `lCPYE` 和 H23 为准。

- [x] 按 DESIGN.md 的 Side Pane 合同实现右侧独立框架：12px 圆角，4px 间距，独立标签栏。打开后会话区左移，关闭后恢复居中。
- [x] C20 标签栏：只支持「计划」这一种标签。× 关闭单个标签，`panel-right-close` 关闭整个 Side Pane。重复打开同一份计划时聚焦已有标签。
- [x] 计划标签的正文是完整的 Markdown，可以滚动，支持下载和复制。
- [x] 入口：C40 的「展开」和 C41 的计划卡。打开时同时关闭 C41。
- [x] Side Pane 本身不持久化；会话恢复后，可以从 Transcript 重新打开计划。
- [x] 补全 zh/en 文案。
- [x] DESIGN.md：补充 C44 和最小 Side Pane 的规则。
- [x] Chromium 测试：
  - 两个入口都能打开 Side Pane
  - 标签复用、关闭标签、关闭面板
  - 会话区左移与恢复
  - 窄宽度下的表现
  - Light/Dark 两种主题
- [ ] 全部完成后用 agent-browser 验收一次，覆盖 H19–H23 的流程，使用 loopback fake provider。

## Comments

Implemented the minimal Transcript-derived Plan pane with C40/C41 entrypoints, stable local tabs, shared Markdown actions, independent frame and bounded narrow overlay. Existing Radix Tabs, beUI Button and ScrollArea/Markdown are reused; beUI's pill/segment tabs do not supply the document-tab close role, so the installed Radix primitive supplies keyboard and ARIA semantics without a dependency.

Focused browser evidence covers both entrypoints, restored/repeated plans, tab reuse/keyboard/close, full Markdown scrolling and fresh snapshot content, copy/download/error boundaries, unchanged shell geometry, top/middle reading and streaming bottom-follow, Light/Dark/420px and enlarged text, pending-permission shortcut exclusion, and explicit Summary opening while the narrow overlay is active. The real-wheel regression additionally covers permission arrival, sidebar close and narrow resize after reading older messages. UI types, scoped lint/format and documentation checks passed. Exact command logs, source Save hashes and RED/GREEN history are recorded in `/Users/chenzheng/Desktop/rukie-desktop-plan-mode-evidence/ticket-07-verification.md`.

Status intentionally remains claimed with the spec until the root completes final review, aggregate static, desktop package and isolated agent-browser acceptance, then resolves the last ticket and spec together. ADR coverage follows the spec's ADR-0016 projection/transient display choice; no persistence or execution contract was added.
