# 01: 共享动画时钟与扫光

Status: ready-for-agent

**What to build:** 在 `@neant/tui` 补齐状态行需要的渲染基础，见 spec 的 ①② 节。

- `ClockProvider` + `useAnimationFrame(intervalMs | null)` 返回 `[ref, time]`，所有订阅者共用一个定时器，同 dsh-TUI 的实现；`Spinner` 改用它。
- `color.ts` 从 logo 的 `bigfont.ts` 下沉 `rgb` / `hex` / `interpolateColor`，logo 改为从 `@neant/tui` 引用。
- 移植 `sweep()`，输出合并后的着色段。
- 新增 token `activity #7DA1DE`、`activityFlash #C6D8F8`。
- `figures.activityFrames` 用 moon8（120ms）。

**Blocked by:** —

- [ ] 两个订阅者只开一个定时器；全部卸载后停表；传 `null` 不订阅
- [ ] `Spinner` 现有测试不改断言即可通过
- [ ] `sweep`：窗口外为 base，窗口随 time 前进，相邻同色合并，CJK 按 2 列计
- [ ] logo 测试保持通过，`bigfont.ts` 里不再有私有颜色函数
- [ ] 拷贝代码文件头注明 dsh-TUI 来源
- [ ] `bun run check` 全绿
