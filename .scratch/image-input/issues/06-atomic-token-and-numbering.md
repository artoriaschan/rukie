# 06: token 原子交互与编号

**What to build:** `[Image #N]` token 在输入框中像单个字符：光标不进入、整删、选区覆盖整个 token；删掉即解绑，手打同文不算；编号在 Session 内递增，新上下文时重置。详见 [图片输入 spec](../spec.md) 的 Composer token 一节。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] 光标移动按方向吸附 token 边界；Backspace 在末尾 / Delete 在起点整删；选区边缘落入 token 时外扩；自动换行不在 token 内断开
- [ ] 文本不再含某 token 时解绑；手打 `[Image #1]` 不绑定；输入历史恢复的 token 不绑定
- [ ] 编号单调递增并跳过草稿中已存在编号；`/new`、resume、rewind、切换模型重置为 1 并清空暂存
- [ ] TUI e2e：左右移动跨越 token；整删后发送不带图片；手打 token 不带图片；#1、#2、删 #1 后为 #3；`/new` 后为 #1；40×12 与 resize 后 token 不被拆行
