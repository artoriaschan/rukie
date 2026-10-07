# 03: 改接 design-system 与通用输入编辑器

Status: resolved
Blocked by: 02
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

保留 Rukie design-system、主题、纯历史/编辑逻辑，全部基于 dsh 原语组合。dsh 没有 TextInput/Spinner，迁移 Rukie 编辑组件而非引入 excluded dsh components。不得保留旧 `tui-text` host、旧 cell renderer 或旧 API 适配层。

- [x] themed、divider、status-icon、tooltip、list-item、split-diff、smooth-reveal 等使用新 Box/Text/hook；dimColor 改 dim，原 inline noSelect/click/softWrap 重构到实际新原语
- [x] TextInput 基于 dsh Text/Box/useInput/useDeclaredCursor，保留 grapheme/caret、选区替换、编辑范围、atomic unit、highlight ranges、history draft/caret、回调及 async paste at live caret
- [x] 验证 atomic click、普通/空白 click、wrap/resize、中文/emoji、只读编辑器、提交/多行/六行上限；新公共组件 seam 使用注入 headless terminal
- [x] 保留 Spinner 产品组件，animation hook 的 interval/ref/tuple API 按新声明改接；保留 smooth reveal 自有调度
- [x] 约定供 04 与 05 使用的新 public barrel 类型、stream mount 与 pointer events；全部组件不依赖 dsh theme/themePrefs/ui
- [x] 修改/迁移受影响公共组件测试；focused test timings 记录，虚拟钟及完成信号符合根规则

## 实现与验证

- 从已验证 02 tip `71eac6ee3c6712c279fd7933b1b14999ed11e927` 开始，原生 runtime import 全部向下；product TextInput/history/text 组合与 Spinner 独立保留，没有旧 host/renderer facade、dsh theme/themePrefs/ui 依赖。
- TextInput 渲染真实 Box/Text，通过 measureElement/useDeclaredCursor 与原生 useInput 处理 grapheme、选区、history draft/caret、atomic/highlight、只读和六行 viewport。新组合测试覆盖 async paste 在 live caret 一次插入、atomic wrap/resize/完整替换，同一单位 press/release、普通空白及跨单位/resize 手势拒绝。
- SplitDiffView 使用 `onSourceMount(id, DOMElement | null)` 注册 old/new 稳定身份；应用 05 负责 reading anchor registry。source/path 点击按可见 glyph 拒绝 sigil/gutter/空白/padding，源码仍可原生选择。ThemedText 原生 props；dim、Box noSelect 与 `ansi:*` 颜色；native useInput(input,key,event)、InputEvent.isPasted/Key flags 是 05 的迁移契约。
- 保留 tooltip600ms 和 smooth reveal 自有30fps 调度。公开注入 xterm 测试验证599/600ms tooltip、键盘/resize dismissal、32/33ms reveal 与完成身份 remount；Spinner 与 ClockProvider ref/tuple 迁移后验证帧、同步与 unsubscribe。
- 公开 red 回归推动最小 native 修正：初始光标 paint 在 layout effects 后；完整 ZWJ emoji 在右边界绘制；单次 stdin chunk 的 printable+Enter/C0 顺序；click typed press 坐标传递（通用路由语义不变）。原始源 manifest 差异逐项见 ink README。
- Bun1.4.2 在 advanceTimersByTime(0) + 真实 xterm I/O 时推进实际毫秒，导致599ms timer 提前触发；固定 now 仍复现。采用 pinned test-only `@sinonjs/fake-timers`15.4.0（自带类型），保留真实 setImmediate/输出 completion 并冻结虚拟截止时间；版本/原因记录 docs/tech-stack.md。所有改接 mount 执行 unmount→waitUntilExit→cleanup→terminal.dispose，chalk level 在最后根释放后恢复，无并发全局 fake clock。
- focused 命令：`env -u NO_COLOR bun test packages/coding-agent/tests/ink/primitives/text-input.test.tsx packages/coding-agent/tests/ink/primitives/bounded-input.test.tsx packages/coding-agent/tests/ink/primitives/spinner.test.tsx packages/coding-agent/tests/ink/hooks/animation-frame.test.tsx packages/coding-agent/tests/ink/design-system packages/coding-agent/tests/ink/runtime.test.tsx`：**35 pass / 182 assertions / 709ms**；editor/history 最大78ms，runtime child94ms，timer组合2–5ms；没有超过1秒 case。
- scoped oxfmt、Oxlint、`git diff --check` 与 `bun run check:ink-boundaries` 通过。全仓 tsc 当前仍受 05 未迁移应用与 06 旧 renderer 测试阻塞；03 design-system/fixture/tests 无诊断。最终 aggregate gate 归 06，未在此票重复运行。
