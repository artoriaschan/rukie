Status: accepted

# Headless CLI、TUI 与终端渲染栈合为一个 coding-agent 包

`apps/neant-cli`、`apps/neant-tui` 与 `packages/tui` 合并为 `packages/coding-agent`，提供唯一的可执行程序：`-p` 或 `--goal` 进入 Headless CLI，否则进入 TUI，用法对齐 Claude Code。Agent Core 仍是 `packages/agent`，`apps/` 不再存在。两种模式共享一份参数解析，再按模式动态加载，Headless CLI 不加载 React 与终端渲染栈。

终端渲染栈目前只服务 TUI，将来的 web 与桌面端也复用不到终端 cell 网格和 ANSI 输出，单独成包只增加维护成本。它们能复用的是与终端无关的呈现逻辑，因此包内分出 `view/`，在引入 web 或桌面端时整体抽成 UI 包。

包内按目录分层，依赖只向下；上层由 Oxlint `no-restricted-imports` 检查，ink 由 `scripts/check-ink-boundaries.ts` 的 AST 检查 imports、reexports 与 dynamic imports：

- `headless/` 依赖 Agent Core、`cli/` 与 `view/`，不依赖 `tui/` 与 `ink/`。
- `tui/` 依赖 Agent Core、`cli/`、`view/` 和 `ink/` 的入口；`tui/components` 对 Agent Core 只做类型导入。
- `view/` 对 Agent Core 只做类型导入，依赖 `@rukie/i18n` 与 `@rukie/shared`，不依赖 React、`ink/`、`tui/` 或 Node API。
- `ink/` 不依赖 Agent Core、i18n 或任何上层目录。

代价是 renderer 不依赖 Agent Core 的约束从包边界降为目录边界，由上述检查维持。`ink/` 沿用 dsh-TUI 的目录名；合包时内容是 ADR-0005 的自研渲染栈，随后由 [ADR-0013](0013-adopt-dsh-tui-ink.md) 采用固定来源的 ink runtime。

合包完成后项目改名为 Rukie：包作用域、可执行程序、用户与项目配置目录、环境变量前缀一并改名，不读取旧名，已有数据由用户手动迁移。

## Considered Options

- 只把 `apps/` 移入 `packages/`，TUI 应用与渲染栈仍分两个包：保留包级边界，但渲染栈没有第二个使用者，用户选择不做这层拆分。
- 应用包命名为 `packages/agent`，Agent Core 改名 `packages/core`：会让历史提交、ADR 与工单中的 `@rukie/agent` 改变含义，也和 glossary 中 Agent Core 与 Frontend 的区分冲突。
- 渲染栈目录叫 `termui/`：语义更准确，用户选择沿用 dsh-TUI 的 `ink/`。
