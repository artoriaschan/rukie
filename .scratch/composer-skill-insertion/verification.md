# 验证记录

验证负责人：主代理。基线：`71802c6e`，集成分支：`feat/composer-skill-insertion`。

## 范围与约定

- 测试缝沿用 spec 的 Testing Decisions：公开 Session/MCP Host、wire、Chromium 组件与历史消息 DOM。该规格已明确这些缝，实施不重复请求确认。
- 每票使用新的实施代理与独立 worktree；每次集成使用新的合并代理。
- 实施代理先记录红灯，再记录必要 focused 检查及耗时；不独立启动全套检查或手工浏览器验收。
- 静态检查、最终全套检查与手工 Chromium 验收由主代理统一协调；快进、评审、提交与文档修改不使行为证据自动失效。
- MCP Host 改变跨 Session、Run、子代理和 Frontend 的共享生命周期，最终按 spec 运行一次完整 `check`。

## 初始环境

工作区干净。SSH fetch 失败（连接关闭）；HTTPS fetch 失败（SSL_ERROR_SYSCALL）。当前 HEAD 仅比本地 origin/main 多本任务规格提交；继续同一任务基线，发布前重新核实远端。

## 证据

### Ticket 01 — Lexical composer

State: `feat/composer-ticket-01`, based on integration, editor source/tests/dependency lock and tech-stack changes. Runner: Node Vitest 5.0.3 / Chromium, cwd `packages/ui` in isolated `/tmp/rukie-composer-01`. Existing fixture configuration remains isolated; no native Electron or real credentials.

- Initial root `bunx --no vitest run --project ui-browser ...`: startup failure, root filter matched no project, 0 tests. All commands below use `packages/ui`.
- Baseline `bunx --no vitest run --project ui-browser tests/components/composer.browser.test.tsx tests/components/compact-composer.browser.test.tsx tests/components/input-focus.browser.test.tsx tests/app/layout.browser.test.tsx`: 22 passed, 3.80s. Geometry covers title/sidebar/Transcript/dock, wide/narrow and font scaling.
- New compact case, `-t 'plain-text composer'`, before migration: 1 expected red, 2 skipped, 15.56s; old textarea lacks contenteditable. Same case after migration: 1 passed, 2 skipped, 744ms; covers IME, Shift+Enter, multiline paste, send, clear and focus.
- Same four baseline files after migration: 23 passed, 3.71s. Original exact geometry assertions retained; placeholder targets rendered pseudo-element.
- Consumer command `bunx --no vitest run --project ui-browser tests/app/goal-mode.browser.test.tsx tests/app/plan-mode.browser.test.tsx tests/app/plan-pane.browser.test.tsx tests/app/plan-review.browser.test.tsx tests/app/questions.browser.test.tsx tests/app/shell.browser.test.tsx tests/app/transcript.browser.test.tsx tests/app/model-services.browser.test.tsx tests/components/semantic-roles.browser.test.tsx`: 122 passed, 2 failed, 24.96s. Two failures isolated below; other consumer evidence remains valid.
- `bunx --no vitest run --project ui-browser tests/app/shell.browser.test.tsx tests/app/goal-mode.browser.test.tsx -t 'composer selects reasoning|Running and unfinished Goal'`: 2 passed, 38 skipped, 1.76s. IME native Enter linebreak fixed; placeholder checks move to aria-placeholder.
- `bunx --no vitest run --project ui-browser tests/components/compact-composer.browser.test.tsx tests/components/composer.browser.test.tsx tests/app/shell.browser.test.tsx -t 'plain-text composer|composer, permission|paste and drop'`: 3 passed, 34 skipped, 1.38s. Covers capture handling, plain over rich clipboard, unchanged placeholder geometry and image paste/drop.
- `bunx --no vitest run --project ui-browser tests/components/compact-composer.browser.test.tsx -t 'disabled and submitting'`: 1 passed, 3 skipped, 764ms. Covers disabled editability/cursor, exact untrimmed draft and send guard.
- Root `bunx --no tsc -b packages/ui` and focused oxlint: exit 0. Earlier type failures corrected; parent consolidates final static evidence.

Intermediate startup failure: newly imported Lexical modules made Vite reload the collecting test; explicit optimizeDeps includes fix this. Intermediate clear assertion expected an onValueChange callback that the original uncontrolled component never promised; replacement reads exact public DOM text. All prior textarea value assertions now compare exact visible editable text, preserving line breaks and whitespace. No geometry difference authorized. Full/package checks and manual Chromium acceptance remain parent-owned. Later unrelated core changes do not invalidate these editor results.

### Integration and ticket 02

- 票 02 的实施提交 `1cb49e8b` 已快进到集成分支；公开 MCP Host、Session 生命周期与原有 TUI 消费者的 focused 结果记录在[票 02](issues/02-extract-mcp-host-prefactor.md)。干净快进没有使证据失效，未重跑行为测试；统一静态检查和最终共享生命周期完整检查仍待执行。
- 网络恢复：主代理通过 `HTTPS_PROXY=http://127.0.0.1:20800` 的 HTTPS fetch 核实 `origin/main` 为 `52b7bd62`；集成基线包含该提交。
- 集成记录文档验证：`rtk proxy bun run docs:update`、`rtk proxy bun run check:docs`（157 个 Markdown 文件）、两份修改文档的 `oxfmt --check` 与 `rtk git diff --check` 均退出 0。没有更改生产代码，沿用实施代理的行为测试结果。
