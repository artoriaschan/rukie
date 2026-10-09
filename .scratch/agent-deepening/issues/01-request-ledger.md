# 01: Request Ledger

**What to build:** 新建 `src/requests/`，接管 `session/index.ts` 中 Request 身份铸造与识别、`RequestDoc`、`registerSubmission`、`resultFor`、`requestCausesForTasks`、`requestWaiters`、`currentRequestId` 及启动恢复重建。Session 公开接口不变。详见 [spec](../spec.md)。

Blocked by: None (can start immediately)

Status: resolved

- [x] Session 内不再有 Request ID 的 `startsWith`/正则解析
- [x] 字符串编码与 `RequestDoc` 格式不变，已有恢复 e2e 通过
- [x] `tests/requests/` 用内存 Storage 覆盖身份、因果与结算
- [x] 结果组装为纯函数，Goal 与 Subagent 回执规则可直测
- [x] hook stop 与 plan takeover 的 4 处首输入写入收敛为 Ledger 的事务内写入
- [x] 等价 e2e 断言迁移，保留每条恢复路径一个冒烟用例

## Answer

`src/requests/` owns persisted Request identities, bindings, native ownership/send causality, settlement waiters, foreground identity and startup reconstruction. `rukie.requests`, `rukie.hook-stops` and `rukie.plan-takeovers` retain their version-1 shapes. Session calls Ledger transaction methods for accepted Goal tasks, native inputs and first-input outcome facts; notices remain in the caller's same transaction. Goal/Subagent own pure receipt readers; normalized Request assembly is pure. Frontend Session API remains unchanged.

Verification: 128 pass / 0 fail across 12 focused files in 9.39s (`requests/`, Goal trio, Run, subagent report recovery/identities, Session recovery, async hooks, Plan Mode); `bun run check:dev` passed (format, lint, types, Knip, scratch/docs and ink boundaries); `git diff --check` passed. The Ledger fixture was then extended with Human-linked Goal union accounting and passed all five Ledger cases in 85ms. One equivalent Goal activation receipt e2e was moved to in-memory native Harness/Ledger coverage: 88.79ms before, 3.91ms after. Existing Goal admission-loss and subagent crash recovery scenarios remain intact; process-crash coverage is intentionally real time. No full-suite run here: integration final acceptance owns the single aggregate run.

ADR coverage: follows ADR-0011 capability dependency direction and ADR-0024 native storage, task and receipt ownership; no new architecture decision or persisted format change. The user's existing `identity.ts` was copied byte-for-byte into the implementation worktree and preserved unchanged.
