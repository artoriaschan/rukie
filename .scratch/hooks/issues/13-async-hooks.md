# 13: async 与 asyncRewake

**What to build:** 日志、通知类 command hook 在后台运行不拖慢 agent；后台检查发现问题时可以把 agent 叫回来。见 [spec](../spec.md)「执行与协议」。

Blocked by: 01

Status: resolved

- [x] `async: true`：立即返回，不参与决定，不受超时约束；完成后的 `additionalContext` / `systemMessage` 在下一次模型调用前注入。
- [x] `asyncRewake: true`：后台完成且 exit 2 时，session 空闲则以 stderr 作为 user 消息起新 run，run 中则 steer。
- [x] `dispose()` 存在时（05）中止仍在跑的 async hook；05 未落地时不阻塞本票。
- [x] Agent Core e2e：async hook 不阻塞工具调用、结果下一次注入、asyncRewake 在 run 中 steer。

## Delivery evidence

- Implemented with `/implement` and public Agent Core / TUI / CLI e2e tests in the independent `codex/hooks-13` worktree.
- Background command hooks return immediately, ignore handler timeouts and control decisions, and persist / inject completed context and system messages before the next actual model request, including completions during awaited compaction hooks.
- `asyncRewake` exit 2 uses stderr feedback without `UserPromptSubmit`: active Runs continue through tool, Stop and child-wait boundaries; idle Sessions start an observable, cancellable Run. Parent disposal also cancels background hooks retained by completed children.
- Session subscriptions replay startup events once and keep Core-owned running / interruption state visible in TUI and CLI. Startup human tasks wait behind hook autoruns, retain normal prompt hooks, take priority over queued rewakes, and cancel without transcript writes. Normal competing user Runs remain rejected.
- Fresh independent Standards and Spec reviews rechecked `26ce1c2867a998eeb677c75b49a5ddc5f4c77751`: both reported zero remaining findings. Standards verified 118 public tests / 540 assertions; Spec verified 134 public tests and the original compaction / startup reproductions.
- Focused async / permission / compaction / subagent / Stop / lifecycle / TUI / CLI checks: **193 pass, 0 fail** across 13 files. Startup / idle race cases also passed ten repeated focused runs before final integration.
- Fresh full `bun run check` with an isolated temporary `HOME` and `NO_COLOR` removed: **1352 pass, 0 fail**, 7140 assertions across 103 files; formatting, lint, TypeScript and knip passed. Evidence: `/tmp/neant-hooks-13-delivery-check.log`.
