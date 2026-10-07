# 01: 光标停在 token 上显示预览

**What to build:** 用户在输入框草稿里把光标移到已绑定的 `[Image #N]` token 起始位置时，消息区显示这张图的被动预览卡，token 反色；光标离开即消失。预览不抢键盘，打字、←/→、Enter 发送都照常。见 [spec](../spec.md) Implementation Decisions。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 光标在已绑定 token 的 `start` 时，消息区出现预览卡，标题 `Image #N`，带元数据行，不盖住输入框与状态行
- [x] 命中的 token 反色；renderer 的 highlight 通道支持 `inverse`
- [x] 光标在 token 之后那一格或其他位置时无卡
- [x] 两个 token 间 ←/→ 移动，卡随之换图
- [x] 预览显示时打字照常进入草稿；Enter 照常发送，模型调用附带图片，发送后卡消失
- [x] 被动卡无 `Open original`、无翻页提示，不接收键盘
- [x] 手打的字面 `[Image #N]` 不触发；删除 token 后卡消失
- [x] 无 kitty 图形能力时给出与消息区预览一致的文字占位
- [x] `TextInput` 新增 `onCursorChange`，renderer README 契约同步更新
- [x] e2e 覆盖以上行为；集成代码 `3950234` 的 `env -u NO_COLOR bun run check` 通过（2512 pass / 0 fail）

## Answer

实现 renderer snapped UTF-16 光标通知与 inverse highlight，PromptInput 转发、composer 读取既有绑定，Chat 派生单图被动预览，ImagePreview 被动模式禁用控制和输入订阅。同步 renderer 与 TUI README。

验证：先通过 app start/headless e2e 复现光标进入已绑定 token 无卡（red），实现后通过。`env -u NO_COLOR bun test apps/neant-tui/tests/e2e/composer-image-peek.test.ts apps/neant-tui/tests/e2e/image-tokens.test.ts apps/neant-tui/tests/e2e/image-preview.test.ts`：31 pass / 0 fail，新增两例约 223ms/190ms。`bun run check:dev` 通过；最终 aggregate check 由 integration branch 在全部 tickets 合并后执行，最后一项的全量验证尚待该门禁。

## Final verification

2026-10-07：集成代码 `3950234` 执行 `env -u NO_COLOR bun run check` 通过，2512 pass / 0 fail，184 files，测试阶段 74.47s。此前票据中的“待最终门禁”已完成；审查发现和修复见 [验收记录](../review.md)。
