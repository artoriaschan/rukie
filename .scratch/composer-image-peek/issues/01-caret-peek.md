# 01: 光标停在 token 上显示预览

**What to build:** 用户在输入框草稿里把光标移到已绑定的 `[Image #N]` token 起始位置时，消息区显示这张图的被动预览卡，token 反色；光标离开即消失。预览不抢键盘，打字、←/→、Enter 发送都照常。见 [spec](../spec.md) Implementation Decisions。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 光标在已绑定 token 的 `start` 时，消息区出现预览卡，标题 `Image #N`，带元数据行，不盖住输入框与状态行
- [ ] 命中的 token 反色；renderer 的 highlight 通道支持 `inverse`
- [ ] 光标在 token 之后那一格或其他位置时无卡
- [ ] 两个 token 间 ←/→ 移动，卡随之换图
- [ ] 预览显示时打字照常进入草稿；Enter 照常发送，模型调用附带图片，发送后卡消失
- [ ] 被动卡无 `Open original`、无翻页提示，不接收键盘
- [ ] 手打的字面 `[Image #N]` 不触发；删除 token 后卡消失
- [ ] 无 kitty 图形能力时给出与消息区预览一致的文字占位
- [ ] `TextInput` 新增 `onCursorChange`，renderer README 契约同步更新
- [ ] e2e 覆盖以上行为（app `start` helper + headless terminal）；`env -u NO_COLOR bun run check` 通过
