# dsh ink runtime

此目录整体采用 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 的 `src/ink/`（122 文件）和 `src/native-ts/yoga-layout`（2 文件），替代原 renderer 管线。来源原始文件的 SHA-256 见 [upstream-manifest.json](upstream-manifest.json)，采用与来源风险决定见 [ADR-0013](../../../../docs/adr/0013-adopt-dsh-tui-ink.md)。`design-system/` 是保留的 Rukie 产品组合代码，独立于 vendored runtime。升级按固定来源的 diff 更新，保留上游代码格式。

## API 与生命周期

`index.ts` 提供 dsh 的公开组件与 hooks。`renderSync(node, options)` 同步返回 Instance；`await render(node, options)` 保留首次 mount 前的 microtask；`createRoot(options)` 创建可复用 root。全屏由 `AlternateScreen` 子树管理。组件 props、ScrollBoxHandle、原生 InputEvent/Key 与 DOMElement 以源码类型为准，应用通过该入口消费。没有旧 renderer 的 fullscreen/env/scroll snapshot/event union API。

调用方注入 stdout/stdin/stderr，关闭时 `unmount()`，等待 `waitUntilExit()`，再 `cleanup()`。在卸载前或卸载后订阅退出都完成；运行错误让两种订阅均 reject。注入 stdout 没有 fd 时恢复序列通过其 write 输出，有 fd 时保留上游同步恢复。selection/search/AlternateScreen 使用 AppContext 的 renderer，多个根独立管理状态与输出。

## 产品组件

`design-system/` 保留 Rukie 主题、TextInput、Spinner、tooltip 与 smooth reveal，经 `index.ts` 导出。ThemedBox/ThemedText 接受原生 Box/Text props：弱化文字用 `dim`，不可选择区域用 Box 的 `noSelect`，ANSI 名称颜色用 `ansi:blue` 等原生 Color。ThemedText 不提供旧 inline click、softWrap 或 border props；点击区域由拥有实际可见 glyph 的 Box 管理。

TextInput 用原生 Box/Text/useInput/useDeclaredCursor 组合，产品 props 保留 controlled value、history、atomicRanges、highlightRanges、cursorStyle、maxLines 与编辑回调。没有显式 columns 时测量所在 Box 的宽度；grapheme 编辑、完整原子单位替换与块光标采用同一产品布局，物理光标用于 IME。`onPaste(input, insert)` 的 insert 在调用时读取当前 caret，并一次归一化 CRLF 后提交；异步调用方负责在编辑器被替换或所属 Session 改变后丢弃旧 admission。atomic click 要求 press/release 位于同一实际原子 Box，普通 glyph、padding 和跨单位手势不激活。

SplitDiffView 的 `onSourceMount(id, DOMElement | null)` 将稳定源行身份交给应用读取位置注册表；并排 old/new 的身份分别挂载。应用拥有 reflow/fold 后的身份与位置策略，原生 renderer 不接收产品 scrollAnchorId。源码/路径的点击区域排除 sigil、gutter、空白和 padding，并保留原生源码选择。

## 本地差异

- 支持依赖搬入 ink 内部：`utils/`、`bootstrap/state.ts`、`handoffAck.ts`、`dsh-adapter/sharp.ts`。所有原来越出 ink 的 imports 缩短一个目录层级；`utils/sliceAnsi.ts` 的 `../ink/stringWidth.js` 改为 `../stringWidth.js`。Yoga 搬入 `native-ts/yoga-layout/`，layout import 同样改为 ink 内部路径。
- 独立 utility 原样保留：env、envUtils、intl、sliceAnsi、execFileNoThrow。semver 的固定长度 tuple 读取添加非空断言，循环范围限定在三个版本段内。
- 最小桩：bootstrap 仅保留 scroll activity 所需状态；handoffAck 禁用 dsh 进程交接；debug/log/crashDetail/earlyInput/fullscreen 不加载 dsh 产品图谱或写用户日志。clipboard utility 仍调用真实进程；应用复制完成语义由产品 host 负责。
- sharp loader 返回真实固定版本 sharp；sixel-worker 仍使用真实 node:worker_threads，Bun 支持 .js URL 解析到 .ts 源文件。
- ink.tsx：stdout 恢复不回退 fd=1；退出保存完成状态与 Error，修复首次 late wait；将 renderer 传给 App。
- App.tsx/AppContext.ts：提供根自己的 stdout 和 renderer。use-selection/use-search-highlight/AlternateScreen 不使用 process.stdout 全局或单根 fallback。
- App.tsx/ink.tsx/hit-test.ts/events/click-event.ts：click 事件携带 press 的屏幕和目标局部坐标；通用 click 路由语义不变，产品编辑器校验 press/release 位于同一原子单位。
- parse-keypress.ts：普通 text token 的 C0/DEL 按顺序拆成独立 key，保留同一 stdin read 中 printable + Enter/清空/删除；bracketed paste 保持一次原始 payload。
- log-update.ts：右边界完整可容纳的双列 grapheme（包括 ZWJ emoji）照常绘制，避免完整 emoji 比 CJK 多丢一列。
- reconciler.ts：所有环境沿用 commit 后 microtask paint；移除 test 环境 layout effect 前的同步 paint，使公开注入测试与产品 caret/IME 时序一致。
- 类型：`renderer-host.d.ts` 声明内部 JSX host 名称，公开组件仍保持明确 props。仅 reconciler.ts 使用有理由的 @ts-nocheck，因为锁定 React19 的 runtime hostConfig 泛型与 @types 不同；ink.tsx DevTools 参数使用单行 @ts-ignore。不改变项目 strict 配置。sixel-codec 的已验证 0..255 palette 下标添加非空断言。
- `index.ts` 为 Rukie 明确导出新组件、hooks 和类型。旧 renderer、scroll、terminal、input、screen、graphics、selection 目录全部删除；保留 editor/text 纯逻辑至 design-system 供产品组合使用。

### 图片消费者的绘制观察

应用通过 `useTerminalImages(requested)` 按需求协商图形、`useTerminalImageCellSize()` 读取实测 cell 像素、`Image source/presentation` 提交 immutable RGBA。图片解码、缩放和裁切由 TUI 的 [image-source](../tui/components/image-source.ts) 拥有；renderer 不接受原图 base64 或 crop 参数。

新增 `usePaintedViewport()` 返回 Box ref 与响应式可见性，首次绘制前为 false；绘制后读取 Yoga 的最新布局、祖先 scrollTop 和 hidden/scroll 裁剪，仅在布尔值变化时更新组件。`useApp().renderer.subscribeFrame(listener)` 在帧提交后通知，返回取消订阅函数，unmount 清除剩余订阅；此最小 renderer 扩展使滚轮导致的原生滚动能释放不可见图片，不需要持续 React 重绘。可见性观察不判断后绘制浮层遮挡；应用打开预览时通过 suspended 显式释放底层画廊需求，renderer 仍拥有 placement 遮挡、裁剪与帧预算。

## 检查与依赖边界

此目录按 ADR-0013 豁免 Oxlint/Knip；oxfmt 同样忽略此目录以保留上游格式。依赖方向由 `bun run check:ink-boundaries` 的 TypeScript AST/module resolution 检查强制，覆盖静态 import、reexport、import-equals、dynamic import 与 require；拒绝无法静态判断的 computed module import。仅允许 ink 内部、npm/标准库和已有的 @rukie/shared，禁止 Agent Core、i18n 与所有上层目录。该检查包含在 check:dev；TUI 仅经 index.ts 导入仍由 Oxlint 强制。

`bun test packages/coding-agent/tests/ink/runtime.test.tsx` 验证公开 render + xterm cells、输入/raw mode/退出、真实 sixel worker/sharp、默认流进程、多根鼠标选字/search 隔离和错误完成。使用帧、xterm write callback、selection subscription、worker message/termination 与 child.exited 同步。依赖精确版本见 [技术栈](../../../../docs/tech-stack.md)，根 bun.lock 是安装依据。spike 的重复生产源码已移除，历史可行性证据保留在 [.scratch/dsh-ink/spike-notes.md](../../../../.scratch/dsh-ink/spike-notes.md)。

### 与 manifest 不同的原始路径

- `src/ink/components/AlternateScreen.tsx`
- `src/ink/components/App.tsx`
- `src/ink/components/AppContext.ts`
- `src/ink/components/ScrollBox.tsx`
- `src/ink/events/click-event.ts`
- `src/ink/events/dispatcher.ts`
- `src/ink/hit-test.ts`
- `src/ink/hooks/use-search-highlight.ts`
- `src/ink/hooks/use-selection.ts`
- `src/ink/ink.tsx`
- `src/ink/layout/yoga.ts`
- `src/ink/log-update.ts`
- `src/ink/parse-keypress.ts`
- `src/ink/output.ts`
- `src/ink/reconciler.ts`
- `src/ink/render-to-screen.ts`
- `src/ink/renderer.ts`
- `src/ink/root.ts`
- `src/ink/sixel-codec.ts`
- `src/ink/stringWidth.ts`
- `src/ink/terminal.ts`
- `src/ink/termio/osc.ts`
- `src/ink/termio/parser.ts`
- `src/ink/update-overflow-guard.ts`
- `src/ink/warn.ts`
- `src/ink/wrap-text.ts`

- 05 应用原生输入与复制接线：`hooks/use-input.ts` 在 layout effect 同步注册输入 listener，与 raw mode 启用同一 commit，避免首批输入窗口；`hooks/use-selection.ts`、`ink.tsx` 暴露 `readSelectionText()`，仅核验并读取最后绘制的选中文字，无原生或 OSC clipboard 副作用。TUI 的异步 host 独立拥有 copied/sent/unavailable/stale 与 Session/modal 生命周期。
- 05 保留产品 editor 组合增加可选 `getValue()`，在原生同批键事件前读应用的即时 controlled value，保留 submit/clear 后紧接输入的公共行为；它不改变原生 renderer/input protocol。
