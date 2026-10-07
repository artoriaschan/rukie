# TUI 渲染器自研：React reconciler → 纯 TS Yoga → cell 网格 → 帧差分 → ANSI

`packages/coding-agent/src/ink/` 自己实现渲染管线：用 `react-reconciler` 维护宿主树，用 Yoga 的 flexbox 算法排版，把结果画进内存里的 cell 网格，再和上一帧做差分，只把变化的部分写成 ANSI。设计参考 dsh-TUI 的 `src/ink/`，但不拷贝它的代码。只有 Yoga 例外（位于 `packages/coding-agent/src/ink/yoga/`）：直接拷贝 dsh-TUI 的纯 TypeScript 移植（`src/native-ts/yoga-layout`，约 3.3k 行，没有外部依赖），文件头注明来源，不依赖 wasm 或 native 包。默认用 inline 模式：已经完成的内容交给终端的 scrollback，只重画底部的活动区。

默认 inline 的选择后来由 [ADR-0006](0006-fullscreen-tui.md) 的全屏 TUI 设计替代；本 ADR 关于渲染管线和代码复用边界的决策仍然有效。

## Considered Options

- 直接用开源 Ink：它按行擦除再重画，没有 cell 网格和差分，长对话流式输出时会闪烁，也很慢。
- 照搬 dsh-TUI 的 `src/ink/`：约 3.5 万行，为 Node 编写，看起来源自 Claude Code 内部的 Ink fork，来源和许可都不清楚。
- 官方 `yoga-layout`（wasm）：需要异步加载 wasm，在 Bun 下多一层不确定性，而且只用得到其中一小部分特性。

## 已接受的风险

dsh-TUI 以 MIT 许可发布，但它的 Yoga 移植首次出现在 2026-08-05 的提交 `809591d4`（提交信息是“Claude Code style fullscreen TUI plugin”），路径和注释都和 Claude Code 内部代码的结构对得上，所以可能并非 dsh-TUI 原创，MIT 许可也未必能覆盖它。为了省掉自己写布局引擎的工作量，我们接受这个风险。如果以后要对外分发，或者来源被确认有问题，就换成自己写的子集或官方 `yoga-layout`。到那时，现有的布局测试可以作为替换后的回归基线。
