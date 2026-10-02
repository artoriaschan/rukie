# 04: Inline scrollback：Static、帧节流、Spinner

**What to build:** 默认 inline 模式能用于长对话：已经完成的内容通过 `Static` 一次性写在活动区上方并推进终端的 scrollback，之后不再重画；活动区保持在底部。快速更新被合并成每 16ms 最多一帧。提供 `Spinner`。

**Blocked by:** 02

**Status:** resolved

- [x] `Static` 新增的子项按顺序出现在活动区上方，在假终端的 scrollback 里每条只出现一次，后续帧不会重复写出
- [x] 活动区高度超过屏幕时只画最底下的部分，不会把重复内容挤进 scrollback
- [x] 同一个 16ms 窗口内的多次 state 更新只产生一次写出
- [x] `Spinner` 会动，unmount 后定时器被清理
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：新增 append-only `Static`，以稳定的子项 key 识别完成项；提交时保存独立布局快照，合帧期间已移除的条目也按顺序保留。静态内容不占活动布局、不参与 cell 差分；inline 写出从当前终端行开始，保留上方 shell 输出。
- 活动区只显示最底下的终端行，增高、缩短及再次增长均不把旧活动帧挤入 scrollback。首帧同步，后续 commits 每 16ms 合并一次；unmount 取消待写帧。`Spinner` 每 80ms 更新并在卸载时清理 interval。
- 假终端新增回归覆盖静态条目只写一次、shell 输出、独立条目的外边距/宽度/边框/中文样式、活动区高度变化、独立 React commits 合帧、合帧期间的静态项保留，以及 Spinner 动画和定时器清理。
- code-review：Standards 无发现；Spec 发现 Static 外边距未计入独立布局的问题，已通过独立容器测量修复并补齐 red-green 回归，复审无未解决发现。
- 最终 `bun run check` 全通过：格式、lint、`tsc -b`、Knip，以及全仓库 157 tests / 823 assertions。
- 2026-10-02 合入 main：与 03 的输入/resize/终端生命周期实现整合，保留 TerminalContext、输入光标和异常清理；resize 统一进入 16ms 调度，并保留 inline 活动区位置及静态历史。补充静态条目追加、中文输入编辑、缩窄/拉宽的组合回归；合并结果 `bun run check` 全通过，176 tests / 913 assertions。
