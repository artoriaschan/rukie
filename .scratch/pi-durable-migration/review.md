# pi-durable migration final review

Reviewed range: baseline `92d17ca1` → integration head `72631e03055183114b32c6effe7bda3e2a0a91c4`.

The independent Standards and Spec reports remain separate below. One implementation worktree, `/tmp/rukie-pi-durable-final-findings` (`codex/pi-durable-final-findings`), handles their three findings together. The public seams are `createSession`, native Storage/Session commits for persisted fixtures, public subscriptions/snapshots and `readSubagent`; no private SDK patch or additional recovery engine is used. Ticket09 and the spec remain claimed pending independent integration and the coordinator's one aggregate gate.

## Standards

### [P2 hard] Session-owned document contents lacked runtime validation

Original report: `session/index.ts:302–378` declared ten persisted documents using TypeScript types alone. Native `materializeDocumentValue` checked scope/version but returned same-version JSON unchanged. `HookContinuationDoc.count` could bypass the continuation limit and `RequestDoc.tasks.includes` could consume malformed persisted input. This contradicted AGENTS untrusted-data validation and the Agent README recovery contract.

RED: public cold `createSession` with committed version1 `{taskId:null,count:"not a number"}` resolved instead of rejecting (76ms, `/tmp/pi-durable-final-doc-red.log`). The fixture supplies an actual startup Hook effect and a controlled model, rather than reaching into Harness internals.

Fix: Session-owned schemas validate all ten shapes before Harness/Hook startup, including child Conversations. The existing public storage adapter validates every materialized owned document and exact historical `document.copy` source before backend admission. Unsupported versions and malformed contents reject without default/reset. Current startup failures release the writer lease; native copy-admission failure propagates through the existing poisoned Session/caller fault boundary. Typed internal transactions and native lifetime context remain unchanged.

GREEN: `document-recovery.test.ts` covers every malformed shape, repeated failed opening, no model/Hook effects, unchanged commit bytes, same native document ID after explicit repair and valid next-request completion. Actual child scope and a malformed asOf source with repaired current contents are separate cases; the latter rejects child fork with zero child Conversation/model admission. A fixture attempted to clone a native transaction proxy with structuredClone; it was corrected to public Chord copyJson without changing assertions. Native fork copies are definition-free, so validation of ordinary document reads alone was insufficient; copy admission now checks the original sequence explicitly.

### [P3 judgement, possible Duplicated Code] root and child Stop continuation policy repeated

Original report: child Stop Hook near line1846 and root near2860 repeated the persisted count lookup, eight-continuation guard/warning and count+1 transition.

Refactor: owning `hooks/continuation.ts` now owns the stable document, anchor-aware budget read, warning facts and native transaction advance. Session retains root/child Hook inputs, committed notices, callback routing and message facts. This is a policy refactor, with no invented RED or new controller/execution path. Existing public Stop/SubagentStop protocol, ninth-block limit, budget reset, cancellation and child routing remain green:42 cases,186 assertions,3.74s (`/tmp/pi-durable-final-hooks.log`).

## Spec

### [P2] reused provider call IDs changed earlier Tool Views

Original report: `observation.ts:251–259` built a whole-Transcript argument map keyed only by provider `toolCallId`, then enriched every result; `present()` near608–615 repeated this. A later call with the same ID replaced earlier read path/offset/name and could change its presenter or file action. This violated recovered display (story44) and coherent committed snapshot (spec62/82).

RED: actual public Session Turns read `first.txt` offset2, read `second.txt` offset3, then Bash, all with `reused-id`; the first committed read acquired a Bash terminal card (112ms, `/tmp/pi-durable-final-views-red.log`). After the algorithm fix, the expected path was corrected to the original relative provider argument; production permission/execution normalization remains independent.

Fix: both projection and fresh child presentation use one chronological enrichment pass. Each result gets the arguments visible at its position, before a later Turn may replace that provider ID; current native ToolTask views still use their own committed slot arguments.

GREEN: public live message_end, initial snapshot, Session.messages and cold resume preserve both original read cards/path/offset, even after a different tool name reuses the ID. A real foreground child independently exercises fresh `readSubagent` presentation and cold recovery. Controlled provider contexts remain4 root/6 delegated calls, with zero cold model requests; no extra execution is introduced.

## Current verification

Focused document/views/Stop/child observation/Checkpoint consumers:110 PASS,617 assertions,7.73s across7 files (`/tmp/pi-durable-final-focused.log`). Valid native pending request and Goal resume siblings:26 PASS,140 assertions,2.38s across3 files (`/tmp/pi-durable-final-resume.log`). Focused performance remains below one second per new document/view case; required actual Hook process integration remains in existing owner tests. `bun run check:dev` exit0 (`/tmp/pi-durable-final-findings-static.log`): formatting, lint, TypeScript, Knip, tracker,46 Markdown and ink AST boundaries. Targeted docs/tracker/format and git diff checks also pass at handoff. No package or aggregate was run by this implementer; the final aggregate has not yet run.

ADR coverage: ADR-0024 owns native transactions, recovery, close and malformed-state rejection; ADR-0011 keeps Hook policy in hooks and Session composition above it; ADR-0016 preserves coherent display facts. The changes enforce these existing decisions and introduce no new long-term architecture or renderer differences.

## Independent correction acceptance

2026-10-08：独立 merger 复核 `28acbdcad7a43e40d94aacf80663d561b8b3a7e8` 的10文件 correction diff、全部三项 finding 的实际 RED／GREEN 与当前 focused/static 证据。Standards 原 reviewer 确认 persisted-document P2 与 continuation-policy P3 均 resolved；Spec 原 reviewer 确认 reused-provider-ID presentation P2 resolved，两轴均无具体新增或剩余 finding。Merger 核对十个 schema 在根及 child startup 先于 Harness／Hook 校验，公开 materialized read 和原生 definition-free historical copy 的精确 source 也校验；未增加私有 SDK、默认重置或另一恢复引擎。原生失败继续传播并释放失败打开的租约。Stop policy 由 hooks 拥有，Session 只保留调用与通知路由；消息及 fresh child projection 使用同一按时间顺序的配对规则。已独立集成 correction；文档／tracker／受影响Markdown格式／diff检查通过，无新增测试或package/full运行。09与spec仍claimed，最终aggregate结果尚不存在。
