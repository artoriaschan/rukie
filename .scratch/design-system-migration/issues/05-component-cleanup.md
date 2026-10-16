# 05：清理未使用和违规的组件，产品层按钮统一用 Button

Status: ready-for-agent
Blocked by: 04

**What to build:** 每个角色只保留一个实现，删除规范不允许的装饰组件，产品层的操作统一使用 Button 原语。见 [spec](../spec.md) 中的「共享原语」一节。

## 任务

- [ ] 删除以下组件，并删除它们在 `components/index.ts` 中的命名空间导出。下面列出的组件在 `src/` 和 `tests/` 中都没有消费者；跨包只导入 `DesktopHost` 类型（基线 `cc17c80b`）。
  - `motion/button/stateful.tsx`、`metallic.tsx`、`magnetic.tsx`，以及 `motion/magnetic.tsx`（如果没有其他消费者）。
  - `motion/drawer.tsx`、`motion/center-morph-modal.tsx`。
  - `agents/loading-states/reasoning-text.tsx` 及其独占的 `motion/text-scramble.tsx`。理由：DESIGN.md 的 Motion 一节规定，只在真实运行期间使用 Agent Loading States 或 Text Shimmer。
- [ ] 删除后再次检查 `components/index.ts` 中的其余命名空间，例如 `actionSwap`、`actionSwapRoll`、`loader`。没有消费者，或违反 Motion 规则的，一并删除。保留的项要在 Comments 中写明消费者。
- [ ] 把产品层的原生 `<button>` 改用 Button 或已安装的原语：
  - `app/index.tsx:1194`（侧栏遮罩）和 `app/index.tsx:1279`（欢迎页 Project 下拉触发器）。
  - `app/new-chat-selector.tsx:163`、`:180`、`:234`。
  - `components/sidebar.tsx:99`、`:164`。
  - `components/project-row.tsx:265`。

  无法改用的，例如遮罩这类只用于关闭的覆盖层，在 Comments 中逐项写明原因，并确认它的光标、焦点和可访问名称符合规范。

- [ ] 注册库原语（switch、radio、checkbox、select、context-menu、preview-rail、command-palette）自己负责内部的原生按钮，保持不变。agents/* 复合组件中的普通操作改用 Button。
- [ ] 运行 Knip，确认没有残留的未使用文件、导出或依赖。如果依赖有变化，同步更新 `docs/tech-stack.md` 和 lockfile。
- [ ] 测试：在受影响的 sidebar、new-chat-selector、project-row、shell 套件中补充或更新 Button 的光标、焦点和可访问名称断言，然后运行这些受影响的文件。
- [ ] 运行变更文件的 lint、类型检查、Knip 和格式检查。用 agent-browser 对侧栏、新聊天选择条和欢迎页做局部验收。

## Comments
