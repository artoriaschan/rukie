# 07：Run/Trace 呈现符合 DESIGN.md 契约

Status: ready-for-agent
Blocked by: 01, 02

**What to build:** 让 Transcript 的执行过程呈现符合 DESIGN.md「Run and Trace presentation」一节，重点是读者展开选择的保持和生命周期默认值。实现依据是 [spec](../spec.md) 的「Run/Trace」一节。改动只涉及呈现，不改变 Session、Run、Run Outcome、Interaction 或权限语义。

## 已确认的不符合项（基线 `cc17c80b`）

- `components/transcript.tsx:51-53`：失败、中止或运行状态下用 effect 执行 `setExpanded(true)`，会覆盖读者已经收起的选择。DESIGN.md 第 356 行要求此时不重开。
- `components/transcript.tsx:48` 的 PromptGroup 展开状态、活动段 `AgentActivity` 的内部 `defaultOpen` 状态，以及 `components/tool-row.tsx:93` 的工具详情状态，都是虚拟行内部的组件 state，虚拟行回收后重新挂载就会丢失。DESIGN.md 第 356 行要求在当前 keyed Session 视图中保留这些选择。
- `tool-row.tsx:93` 只在挂载时根据 `tool.status === "error"` 决定初始展开。工具在挂载后才失败时，不会按默认展开。

## 任务

- [ ] 先对照 DESIGN.md 的 Required presentation scenarios 表，逐行审计当前实现，把结论写入 Comments。审计范围还包括：
  - 外层摘要的单行 Text Shimmer 和完成后的类别摘要。
  - 「已处理」和「已用时」。
  - 拒绝结果出现在原位置。
  - 并行调用和复用 provider call ID 时身份稳定。
  - 收起时焦点回到披露控件。
  - 已关闭的详情不在可访问树中。
  - 没有嵌套的纵向滚动。
  - 420px 宽度下可用。
- [ ] 每个不符合项先写一个失败的公开行为测试，用 App `start` 或 wire 脚本复现。涉及流式更新顺序的场景，要复现相关的更新顺序。然后再修复。
- [ ] 在当前 keyed Session 视图中新增展开选择状态，按呈现身份记录读者的显式选择：PromptGroup、活动段和工具调用的投影 id。没有显式选择时，使用生命周期默认值：
  - 进行中：展开。
  - 正常结束：收起。
  - 失败或中止：展开。
  - 历史记录：按已知结局推导。
  - 活动段：收起。
  - 推理：收起。
  - 失败的工具：展开。

  这份状态不持久化，也不进 store 中的 Core 投影。完整重置视图后恢复为默认值。

- [ ] 移除强制重开的 effect。错误和结局在收起状态的摘要中保持可见。
- [ ] 测试覆盖以下场景：
  - 读者在流式 delta、工具完成、外层结束和虚拟行回收之前做出的展开或收起选择，之后都保持不变。
  - 挂载后才失败的工具按默认展开，除非读者已做选择。
  - 失败、中止、正常结束和未知历史结局的默认值。
  - 选择不会重置焦点或文本选区。
  - 展开时保持阅读锚点，只在读者位于实时边缘时跟随。
  - 减少动态效果。
  - zh 和 en。
- [ ] 运行 transcript、tool-output、conversation-dock 等受影响的文件。共享的虚拟化和滚动行为跨模块，需运行一次 `bun run test:desktop`。
- [ ] 用 agent-browser 验收：使用 loopback fake provider 跑一次带推理、工具、失败和并行调用的 Run，检查 Light、Dark 和 420px 宽度。
- [ ] 同步更新 `packages/ui/README.md` 的「对话呈现」一节。

## Comments
