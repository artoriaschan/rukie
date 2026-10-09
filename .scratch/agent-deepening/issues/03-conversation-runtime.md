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
