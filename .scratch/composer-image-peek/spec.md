Status: resolved

# Spec: 输入框图片光标预览

来源：[终端图形协议（kitty 缩略图与预览）](../agent-core-roadmap/issues/21-terminal-graphics.md) 的 Answer。扩展已交付的 [消息流图片预览](../image-message-preview/spec.md)。参考 dsh-TUI `src/screens/Chat.tsx` 的 caret-driven preview。

## Problem Statement

用户在输入框里粘贴或贴入图片后，草稿里只剩一个 `[Image #N]` token。多张图片时，发送前分不清哪个 token 对应哪张图，也无法确认贴对了。现有预览只能从消息区缩略图打开，这时图片已经发出去了。

## Solution

光标停在已绑定的 `[Image #N]` token 上时，消息区上方显示该图的预览卡，token 反色。光标离开，卡消失。预览不抢键盘：用户照常打字、移动光标、发送。Esc 只关掉当前这张卡，光标离开再回来会重新显示。

## User Stories

1. 作为 TUI 用户，我想把光标移到 `[Image #N]` 上就看到这张图，以便发送前确认贴的是对的图。
2. 作为 TUI 用户，我想看到光标所在的 token 反色，以便知道预览的是哪个 token。
3. 作为 TUI 用户，我想光标离开 token 后预览自动消失，以便消息区恢复原样。
4. 作为 TUI 用户，我想光标停在 token 之后那一格时不算在 token 上，以便在 token 后接着打字不被预览遮挡。
5. 作为 TUI 用户，我想用 ←/→ 在多个 token 之间移动时预览跟着换图，以便逐张核对。
6. 作为 TUI 用户，我想预览显示时键盘仍归输入框，以便边看图边改草稿。
7. 作为 TUI 用户，我想预览显示时 Enter 照常发送、图片照常附带，以便核对完直接发送。
8. 作为 TUI 用户，我想按 Esc 只关掉当前这张预览，以便看完后腾出消息区。
9. 作为 TUI 用户，我想在 Run 进行中按 Esc 关预览时不会中止 Run，以便关卡不带副作用。
10. 作为 TUI 用户，我想光标离开被关掉的 token 再回来时预览重新出现，以便需要时再看一次。
11. 作为 TUI 用户，我想关掉一张预览后移到另一个 token 时那张照常显示，以便关闭只作用于当前 token。
12. 作为 TUI 用户，我想预览卡标题显示 `Image #N` 和图片元数据，以便对上 token 编号。
13. 作为 TUI 用户，我想预览覆盖消息区、不盖住输入框和状态行，以便同时看到草稿。
14. 作为 TUI 用户，我想预览卡上没有打开原图入口，以便不会误以为键盘可以操作这张卡。
15. 作为小终端用户，我想终端过小时不显示预览，以便输入框不被挤掉。
16. 作为 TUI 用户，我想审批或提问交互待处理时不显示预览，以便交互面板不被遮挡。
17. 作为 TUI 用户，我想在非 chat 视图、模型或 Session 选择器、Rewind 中不显示预览，以便这些界面不受干扰。
18. 作为 TUI 用户，我想点缩略图打开的模态预览优先于光标预览，以便两者不叠在一起。
19. 作为 TUI 用户，我想手打的 `[Image #N]` 字面文字不触发预览，以便只有真正绑定的图片才会显示。
20. 作为 TUI 用户，我想删掉 token 后预览立即消失，以便不残留已移除的图片。
21. 作为 TUI 用户，我想提交或清空草稿后预览消失，以便新草稿从干净状态开始。
22. 作为终端不支持 kitty 图形的用户，我想预览照常给出文字占位与元数据，以便行为与消息区预览一致。

## Implementation Decisions

- **renderer `TextInput` 加光标回调**：新增可选 `onCursorChange(offset)`，报告吸附 atomic range 之后的 UTF-16 光标位置，光标变化时触发（含 owner 重置 value 导致的变化）。`TextInput` 不感知图片；`@neant/tui` 不依赖 Agent Core。更新 renderer README 的 `TextInput` 契约。
- **命中判定归 Chat**：Chat 用 composer 的 `ranges(draft)`（只含仍绑定的 token 原位置）判断光标是否等于某个 range 的 `start`。光标在 token 的 `start` 才算命中，`end` 不算。命中时通过 composer 取该 token 绑定的 `PromptImage`；composer 需新增按光标位置返回绑定图片的读取接口，复用现有绑定表，不另建状态。
- **token 反色**：命中的 token 反色显示。现有 `highlightRanges` 只带 color；优先扩展它支持 `inverse`，不另加渲染通道。
- **派生状态，非模态**：光标预览是由「光标位置 + 草稿 + 屏幕拦截条件」派生的显示状态，不写入模态预览的 `previewRef`，不走模态预览的按键分支。键盘始终归输入框；←/→、Enter、打字行为不变。
- **Esc 关闭**：光标预览显示时，Chat 的 Esc 链最先处理：记下被关闭的 token（按 token 文本 + 位置区分），消费这次按键，不触发中止 Run 等后续 Esc 行为。光标离开该 token 时清除记录。双击 Esc 打开 Rewind 只在空草稿时成立，与此不冲突。
- **`ImagePreview` 被动模式**：现有组件新增被动模式：标题 `Image #N`（用 token 编号），单图、无翻页计数，不显示打开原图入口与翻页提示，不接收键盘。其余照现有：位置为消息区视口、元数据行、kitty placement 及其清理、无图形能力时的文字占位。
- **显示条件**：与模态预览入口 `openImage` 的拦截条件一致：有待处理交互、非 chat 视图、Rewind 中、模型选择器或 Session 选择器打开时都不显示；另加小终端（`columns < 40 || rows < 12`）不显示。模态预览打开时只显示模态预览。
- **生命周期**：token 被删除、草稿提交或清空、composer `reset`/`clear` 后，命中自然消失，预览随之卸载；placement 清理沿用 `ImagePreview` 卸载路径。
- **文案**：只复用现有 `image.preview-title` 等键；如需新增键，zh 与 en 同步（ADR-0008）。
- Agent Core、Session、存储格式、图片准入、token 绑定规则不变。

## Testing Decisions

- 唯一接缝：`apps/neant-tui` 的 app `start` helper + headless terminal 的 e2e，放在 `tests/e2e/`。通过粘贴图片路径生成 token，再用按键驱动，断言屏幕。只测可观察行为，不测 Chat 内部状态或 `TextInput` 回调本身。
- 覆盖：光标进入 token 出卡与反色、标题 `Image #N`；离开消失、token 后一格不算；两个 token 间切换；Esc 只关当前卡、Run 不中止（fake model 的 `signal.aborted` 为 false）、离开再回来重新出现、关一张不影响另一张；预览显示时 Enter 发送且模型调用带图片；被动卡无 `Open original`；字面 `[Image #N]` 不触发；删除 token 后消失；小终端不显示；待处理审批或提问时不显示；模态预览打开时只显示模态卡。
- Prior art：`tests/e2e/image-tokens.test.ts`（token 粘贴、绑定与光标移动）、`tests/e2e/image-preview.test.ts`（预览卡断言、`click` 辅助、Run 不中止断言、元数据行）、`tests/e2e/permissions.test.ts`/`questions.test.ts`（构造待处理交互）。
- 不单独为 `TextInput` 光标回调或 placement 删除序列加 `packages/tui` 测试：placement 清理已由现有 `ImagePreview` 测试覆盖，回调经 e2e 覆盖。

## Out of Scope

- 鼠标点击 token 打开预览，以及 `TextInput` 的鼠标定位光标能力。
- 鼠标悬停触发预览。
- 贴着输入框的小卡、输入框内缩略图。
- 光标预览里的翻页、缩放、打开原图。

## Further Notes

- dsh-TUI 允许点击 token 强制重新显示；本 spec 不做点击，由「光标离开再回来」承担同样作用。
- 完成后在 [终端图形协议](../agent-core-roadmap/issues/21-terminal-graphics.md) 追加实施证据。

## Delivery

2026-10-07：全部三张实施票已合入 `codex/composer-image-peek`。实现与最终门禁见 [验收记录](review.md)。
