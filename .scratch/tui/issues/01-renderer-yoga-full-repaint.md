# 01: 渲染器起步：Yoga 布局 + Box/Text 全量重画到假终端

**What to build:** 新建 `@neant/tui`。在测试里 `render(<Box><Text>…</Text></Box>, { stdin, stdout })` 之后，假终端屏幕上能看到按 flex 布局排好的内容，中文等宽字符列对齐。这张票每一帧都整屏重画，差分留给 02。管线的前半段打通：React reconciler → 拷入的纯 TS Yoga → cell 网格 → 把整个网格写成 ANSI。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 新增 `@neant/tui` 包，按 CLAUDE.md 的仓库约定组织，加入根 tsconfig 的 references，CLAUDE.md 的目录说明补上这个包
- [ ] Yoga 从 dsh-TUI 拷入，作为包内独立模块，文件头注明来源仓库和 commit（ADR-0005），不对外导出
- [ ] `react`、`react-reconciler`、`@types/react`、`@xterm/headless`（dev）版本精确锁定，写进 `docs/tech-stack.md`
- [ ] 测试辅助：假 stdin/stdout（固定 columns/rows），stdout 的字节喂给 `@xterm/headless`，能读出屏幕文本和光标位置
- [ ] `Box` 支持 row/column 方向、grow/shrink、padding/margin/gap、边框、宽高；`Text` 支持颜色、粗体、暗色、换行和截断
- [ ] 测试覆盖：嵌套 Box 的布局结果、中文等宽字符混排时列对齐、Text 超宽时换行和截断、state 变化后屏幕跟着更新
- [ ] `bun run check` 全绿
