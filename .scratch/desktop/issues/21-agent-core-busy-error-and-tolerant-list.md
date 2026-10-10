# 21: Agent Core busy 错误码与容错列举

**What to build:** 为桌面端准备两项 Agent Core 前置改动：lease 被占用时抛出带 code 的 user-visible error，`listSessions` 按目录容错。见 [spec](../spec.md) 的「Agent Core 前置改动」。

Blocked by: None (can start immediately)

Status: claimed

- [x] 另一个进程持有 lease 时打开 Session，得到带 code 的 user-visible error（含 zh/en 文案），不再是普通 `Error("Session already open")`
- [x] 同进程重复打开同一 Session 的报错同样带 code
- [x] 单个 Session 的索引读取失败时，`listSessions` 跳过它并经 `onWarning` 上报，其余 Session 照常列出
- [x] TUI 与 Headless CLI 对 busy 错误的显示与改动前一致或更清晰，相关测试同步更新
- [x] 接缝：`createSession` + `fakeModel`；跨进程 lease 用现有 `session-store-worker` 子进程 helper

## Implementation evidence

- Claimed by fresh issue 21 agent on `feat/desktop-21`; public seams: `createSession` + fake model, `listSessions`, existing cross-process store worker.

- Red: same-process busy assertion received a plain Error; unreadable-index test rejected with `session-observation-readonly`. Green: both now satisfy coded admission and tolerant listing contracts.
- Added shared `session-busy` with `{ id }`, zh/en frontend copy and TUI formatting. Headless keeps its existing English message. Cross-process worker checks the code while preserving lease/inode/read-only coverage.
- `SessionStore.list` accepts an optional warning callback. JSONL listing catches failures per Session directory (including live-reader failures), preserves healthy entries and never repairs torn bytes; root enumeration failures remain errors.
- ADR coverage: ADR-0008 owns locale-independent errors; ADR-0024 owns native JSONL/read-only observation; ADR-0032 already requires coded shared-store contention. No new architectural decision.
- Focused evidence: ownership 3 pass (1.20 s total; slowest 696 ms), listing 7 pass (373 ms total), TUI affected cases 4 pass (854 ms total), Headless busy 1 pass (153 ms total). No modified case exceeds one second; cross-process costs validate actual kernel locks and process exit.
- Status remains claimed pending integrated review and acceptance.

- Final local focused group: `env -u NO_COLOR bun test` over ownership, listing, TUI errors and view i18n: 39 pass, 0 fail (2.25 s); Headless busy case: 1 pass. `bun run check:dev` passes all format/lint/types/Knip/tracker/docs/boundary/test-policy checks. `git diff --check` passes. No full-suite run in this issue worktree.
