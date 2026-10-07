# 04: edit / write 的 unified diff

**What to build:** edit 与 write 的结果以 diff 卡呈现，覆盖文件也能看到改了什么，新建文件显示为全新增。见 [spec](../spec.md) 的「Agent Core 需补的事实」与 diff 部分。

**Blocked by:** 01

**Status:** resolved

- [x] write 覆盖已有文件时写前读取旧内容存入 `details`；新建文件记 `oldText: null`
- [x] 旧或新内容超过 diff 截断上限时只存统一 patch，不存全文
- [x] edit 与 write 出 diff result view（`{ path, oldText, newText }` 或 `{ path, patch }`）
- [x] TUI 渲染 `-` / `+` 前缀行，多文件以路径行分隔，同文件 hunk 间以 `⋯` 分隔
- [x] diff 正文折叠为 8 行，提示与展开沿用统一规则
- [x] resume 后 diff 卡与 live 一致
- [x] Agent Core e2e 覆盖 write 新建 / 覆盖 / 大文件三种 `details`；TUI e2e 覆盖 diff 渲染与折叠

## Answer

Implemented on `codex/tool-view-04`, commit `a61113b`. Write captures previous text within pi's existing mutation queue using its execution environment, retaining shared write/edit serialization, cancellation and file-tracking wrappers. The 50 KiB diff-text budget stores only a unified patch above the threshold. Result details record the actual target path; edit uses pi's durable actual patch and exposes pending replacement diffs. Unified rendering preserves per-file paths and hunk gaps, uses deletion/addition colors and the eight-line fold. Ticket02 owns unified expansion state; its integration must preserve the diff-specific limit.

Verification: Core public Session tests were red before implementation (4 failures), then green for new/overwrite/large writes, durable replay, pending edit and error fallback (5 tests, 259ms latest; cases 19–39ms). TUI public start/headless-terminal diff test was red before rendering, then both fold and resumed two-file/hunk coverage passed (2 tests, about 210ms combined). Focused regression `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/file-diff.test.ts packages/agent/tests/e2e/file-views.test.ts packages/agent/tests/e2e/checkpoint.test.ts packages/agent/tests/e2e/tools.test.ts` passed 44 tests / 1.54s before adding the extra failure case. `bun run check:dev` passed. Integration tip merged before report (already up to date at a002e86). Final aggregate verification belongs to integration delivery.

### Review 修复验证（2026-10-07）

- pending diff 仅在运行中使用。完成/恢复缺少有效结果 facts 时标题 `Name(args)`、正文原始结果；渲染与搜索使用同一 projection。headless legacy edit 与 raw result 搜索回归通过。
- `bun run check:dev` 通过；最终 aggregate 在 integration branch 统一执行，结果由 spec 验证记录补充。
