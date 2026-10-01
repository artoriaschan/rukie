# 01: 渲染器起步：Yoga 布局 + Box/Text 全量重画到假终端

**What to build:** 新建 `@neant/tui`。在测试里 `render(<Box><Text>…</Text></Box>, { stdin, stdout })` 之后，假终端屏幕上能看到按 flex 布局排好的内容，中文等宽字符列对齐。这张票每一帧都整屏重画，差分留给 02。管线的前半段打通：React reconciler → 拷入的纯 TS Yoga → cell 网格 → 把整个网格写成 ANSI。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 新增 `@neant/tui` 包，按 CLAUDE.md 的仓库约定组织，加入根 tsconfig 的 references，CLAUDE.md 的目录说明补上这个包
- [x] Yoga 从 dsh-TUI 拷入，作为包内独立模块，文件头注明来源仓库和 commit（ADR-0005），不对外导出
- [x] `react`、`react-reconciler`、`@types/react`、`@xterm/headless`（dev）版本精确锁定，写进 `docs/tech-stack.md`
- [x] 测试辅助：假 stdin/stdout（固定 columns/rows），stdout 的字节喂给 `@xterm/headless`，能读出屏幕文本和光标位置
- [x] `Box` 支持 row/column 方向、grow/shrink、padding/margin/gap、边框、宽高；`Text` 支持颜色、粗体、暗色、换行和截断
- [x] 测试覆盖：嵌套 Box 的布局结果、中文等宽字符混排时列对齐、Text 超宽时换行和截断、state 变化后屏幕跟着更新
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：实现 `packages/tui`，对外仅导出 Box、Text、render 和对应公开类型。Yoga 来源为 dsh-TUI commit `646740f12c34546d6c195f5b7031be0dc67421a5`，仅布局模块使用；保持算法原样，增加来源头并应用仓库格式化。
- 假终端边界有 10 个测试，覆盖嵌套布局、grow/shrink、间距、中文双列、跨 JSX 子节点的组合字符、emoji 字素换行、换行/截断、嵌套样式、state 更新、旧行清除、卸载和满屏写出不滚动。换行使用 `Bun.wrapAnsi`，宽度使用 `Bun.stringWidth`。
- `bun run check`：格式、lint、`tsc -b`、Knip 全通过；全仓库 138 tests / 708 assertions 通过。code-review 两轴审查发现的组合字符丢失、换行 API 偏差及强制换行拆开 emoji 字素的问题均已修复并补回归。
- 本票每帧整屏重画，不进入 alt-screen；差分、输入/resize 与 inline scrollback 按后续票据继续。
