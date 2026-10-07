# 01: 共享动画时钟与扫光

Status: resolved

**What to build:** 在 `@neant/tui` 补齐状态行需要的渲染基础，见 spec 的 ①② 节。

- `ClockProvider` + `useAnimationFrame(intervalMs | null)` 返回 `[ref, time]`，所有订阅者共用一个定时器，同 dsh-TUI 的实现；`Spinner` 改用它。
- `color.ts` 从 logo 的 `bigfont.ts` 下沉 `rgb` / `hex` / `interpolateColor`，logo 改为从 `@neant/tui` 引用。
- 移植 `sweep()`，输出合并后的着色段。
- 新增 token `activity #7DA1DE`、`activityFlash #C6D8F8`。
- `figures.activityFrames` 用 moon8（120ms）。

Blocked by: —

- [x] 两个订阅者只开一个定时器；全部卸载后停表；传 `null` 不订阅
- [x] `Spinner` 现有测试不改断言即可通过
- [x] `sweep`：窗口外为 base，窗口随 time 前进，相邻同色合并，CJK 按 2 列计
- [x] logo 测试保持通过，`bigfont.ts` 里不再有私有颜色函数
- [x] 拷贝代码文件头注明 dsh-TUI 来源
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：实现共享时钟及 renderer 默认 provider、Spinner 迁移、共享颜色函数、扫光段、activity token 和 moon8（120ms）。时钟测试额外覆盖独立节流、暂停与恢复；扫光测试覆盖 CJK、组合字符与 ZWJ emoji。
- 验证：`rtk proxy env -u NO_COLOR bun run check`，245 tests passed，0 failed；格式、lint、类型检查和 knip 均通过。清除 RTK 注入的 `NO_COLOR=1`，让终端颜色断言按正常着色环境运行。
- 双轴审查：Spec 无发现；Standards 无违规，1 条可选的测试 fixture 去重建议，保留与现有测试一致的局部 setup/cleanup 写法。
