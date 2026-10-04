# 03: handler 级 `if` 过滤

**What to build:** 用户在单个 hook 上写一条 Permission Rule（如 `bash(git push *)`），只在命中时运行该 hook。见 [spec](../spec.md)「匹配」。

**Blocked by:** 01

**Status:** resolved

- [x] `if` 复用权限规则解析与匹配（复合命令拆段任一段命中、路径规范化）；非法规则加载报错。
- [x] 仅在工具类事件上评估；写在非工具事件上的 hook 永不运行，加载时告警。
- [x] `if` 参与去重键。
- [x] Agent Core e2e：命中运行、未命中不运行、复合命令某段命中运行。

## Delivery evidence

- Implemented through `/implement` with public configuration and Agent Core e2e TDD in the independent `codex/hooks-03` worktree. Rebased onto main `b35ef6679118ab0c25d7e881cf5957f1a309eec2`; the only conflict combined the PostToolUse result-type import with the permission matcher import, preserving both implementations.
- Handler filters are parsed at startup and reuse permission matching for all five tool events. A matching segment of a compound bash command triggers the hook; relative paths, home expansion and canonical symlink targets use the existing permission path behavior. Background command hooks use the same selection path.
- Non-tool event filters never execute and emit loading diagnostics. `loadSettings` retains its `warnings: string[]` contract and adds structured `hookWarnings` only when present; TUI startup formats these diagnostics in its selected locale. Actual Chinese and English startup tests verify settings precedence and prevent duplicate English stderr output. Session diagnostics retain their locale-independent codes.
- Identical handlers with identical `if` values execute once; different filters retain separate handlers. Invalid rules still fail at settings load with their source location.
- Fresh independent Standards and Spec reviews of `84f47483a33d866cdd425d8874c0fc81fa0c7ad9` both reported zero findings, with **226 pass, 0 fail** and **164 pass, 0 fail** respectively. Range-diff after rebase showed only changed surrounding context for the implementation patch and an identical localization fix.
- Post-rebase configuration / after-tool / filter / async / permission / actual TUI startup checks: **128 pass, 0 fail**, 456 assertions across six files. Formatting, lint, TypeScript and knip passed.
- Fresh full `bun run check` with isolated temporary `HOME` and `NO_COLOR` removed: **1382 pass, 0 fail**, 7231 assertions across 105 files; formatting, lint, TypeScript and knip passed. Evidence: `/tmp/neant-hooks-03-delivery-check.log`.
