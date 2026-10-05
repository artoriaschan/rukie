# 06: token 原子交互与编号

**What to build:** `[Image #N]` token 在输入框中像单个字符：光标不进入、整删、选区覆盖整个 token；删掉即解绑，手打同文不算；编号在 Session 内递增，新上下文时重置。详见 [图片输入 spec](../spec.md) 的 Composer token 一节。

**Blocked by:** 05

**Status:** resolved

- [x] 光标移动按方向吸附 token 边界；Backspace 在末尾 / Delete 在起点整删；选区边缘落入 token 时外扩；自动换行不在 token 内断开
- [x] 文本不再含某 token 时解绑；手打 `[Image #1]` 不绑定；输入历史恢复的 token 不绑定
- [x] 编号单调递增并跳过草稿中已存在编号；`/new`、resume、rewind、切换模型重置为 1 并清空暂存
- [x] TUI e2e：左右移动跨越 token；整删后发送不带图片；手打 token 不带图片；#1、#2、删 #1 后为 #3；`/new` 后为 #1；40×12 与 resize 后 token 不被拆行

## Comments

- 2026-10-06：在托管 worktree `image-input-06`、分支 `codex/image-input-06`，确认基线 `1d33795` 包含05。公开 seams 沿用 spec 的 `start` + headless terminal：先重现箭头进入 token、选区替换留下图片、窄屏 token 被拆行、模型切换后编号未重置、`/new` 被送给模型，以及手打副本错误绑定，再逐个实现至绿色。
- renderer 使用通用 UTF-16 `atomicRanges`，编辑与布局共用区间；方向吸附、Backspace/Delete、Shift+导航选区替换以及换行均按整块处理。新增 `onChange` 的可选实际 edit 区间与 `onHistoryRecall`，契约同步 renderer README，不引入 Agent Core 依赖。
- chat 的图片绑定跟随原始 occurrence 的位置，删除立即解绑，手打相同标签与历史恢复仅作为文本。实际 edit 区间避免重复文字导致删除副本时误解绑原图；编号维持递增并跳过字面编号。
- `/new` 是现有 `/clear` action 的别名，保留一条 Session 替换路径和原有菜单布局，别名契约在 command lookup 的本地 JSDoc 记录。resume 使用新 Session 的空绑定；成功模型切换与全部 rewind 模式 reset 并递增 paste epoch，取消旧异步读取。code-only rewind 公共测试同时验证原文件还原且 Conversation 保留；FIFO 延迟读取测试验证 rewind 后不误消费 #1。
- 验证：新增13个 image token e2e 通过；renderer、05图片、输入历史、rewind、model switch、resume picker 集中23文件184用例通过（0失败）。`tsc -b`、`oxlint`、`knip`、`oxfmt` 与 `git diff --check` 通过。最终 aggregate 由主代理在整合集成分支后运行。
