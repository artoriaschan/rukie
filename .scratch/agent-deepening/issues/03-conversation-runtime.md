# 03: Conversation Runtime

**What to build:** `session/conversation/` 工厂为 root 与 child Conversation 装配 permission gate、hook 运行器、jobs、file tracking 与 `beforeTool`/`afterTool`；`forkAt` 与子代理模型选择移入 `tools/subagents/controller`。详见 [spec](../spec.md)。

Blocked by: 01

Status: resolved

- [x] root 与 child 共用一份工具策略序列实现
- [x] Session 不再导入 `tools/subagents/state.ts`
- [x] `tests/session/conversation/` 覆盖阶段顺序与 child origin
- [x] subagent-permissions、subagent-hooks、permission-* e2e 通过

## Implementation evidence

- `session/conversation/` owns per-Conversation stop state, hook runners/transcript binding, Jobs and file-tracking resource identity, permission hook stages and child origin, preparation, replay execution authorization, cancellation failure hooks and result transforms. Root and child use the same ToolTask policy sequence; Session retains durable admission, outcome persistence and notification adapters.
- Subagent controller owns safe fork boundary and model selection (retained child, fork parent, type override, configured default, parent fallback). Session imports capability state definitions through the Subagent entry point.
- Runtime seam was red before introduction (missing module), then passed real MemoryStorage/Harness tests for isolated stop/reset, rewritten authorization before effects, denied effects and child origin/output hook behavior. Representative Session tests remain because they validate frontend/recovery/checkpoint wiring rather than equivalent module assertions.

## Verification evidence

- Targeted permission, subagent, checkpoint and runtime selection: 336 tests passed across 17 files in 13.02s before final resource ownership cleanup refinement.
- After cleanup ownership refinement: runtime/child permissions/hooks/checkpoint selection 35 tests passed in 4.27s; file tracking/model switching 7 passed in 482ms; runtime seam 3 passed in 91ms.
- Combined Jobs selection exited 137 after passing 27 Jobs cases, with no assertion failure. The exact interrupted drain case passed individually (3.19s), then the complete Jobs file passed all 38 cases (7.36s). Kernel logs provided no memory-pressure/Bun-kill evidence; interruption cause remains unconfirmed. Jobs signaling algorithms and original silent cleanup policy were preserved.
- The drain integration test necessarily keeps real OS process-group/pipe lifetime coverage; module cases complete below 30ms and other affected cases below one second.
- `bun run check:dev` passed. Aggregate validation belongs to final spec acceptance; no full check or push performed for this ticket.

Integration: merged latest integration `a26aac55` (01/02/05), preserving extracted Goal abort and Conversation stop state and the new Interaction parser. Goal/child/runtime integration selection passed 53 tests in 3.99s; `bun run check:dev` and `git diff --check` passed after conflict resolution.

## Review resolution

- Standards and Spec review P1 resolved: `ConversationRuntime.stop` restores the existing `Stopped by hook.` fallback when the permission gate calls it without a reason, preserving the root Run stop policy and durable Request outcome.
- RED through the public `createSession` seam: PreToolUse, PermissionRequest and PermissionDenied with `{ continue: false }` and omitted `stopReason` each made two model requests instead of one (3 failures, 354ms). GREEN after the one-line owner fix: all three stop before another model request, settle Run and Request as `hook_stopped`, and retain the default notice and Request result after Resume (3 passes, 325ms).
- Shared child impact coverage verifies each of those Hook stages stops further child model requests, leaves the parent Request able to settle, and retains the default notice after Resume. Existing child directory classification for tool-stage stops remains `aborted`; changing that adjacent behavior is outside this refactor. The six added public Session cases passed in 599ms; every case stayed below one second.
- Focused permissions, Conversation Runtime, permission-hooks, subagent-permissions and subagent-hooks selection: 192 tests passed across 9 files in 4.93s. Synchronization uses Run/Request completion and Session close; isolated temporary homes and projects are cleaned up.
- `bun run check:dev` and `git diff --check` passed after correcting the test notice literal type; the initial static run identified only that new fixture type error.
- Final aggregate gate remains the integration coordinator's responsibility; this review correction does not close ticket06 or the spec.
