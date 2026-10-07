# 02: 子代理最小通路

**What to build:** 模型调用 `subagent { description, prompt, run_in_background? }` 创建一个 `general-purpose` 子代理，即带 `parentSessionId` 的子 session，复用 `createSession`。

- 默认后台：立即返回 `started subagent <id>`。子 run 结束时，结束通知（finished / failed / aborted + 最后一条非空文本）以 user 消息经 pi `steer` 注入父 run。父 run 等名下 running 子代理全部结束且通知送达后才结束。
- 前台：直接返回最终文本，失败时 `isError`，不发通知。
- 限制：深度 1（子代理工具集里没有 `subagent`）；running 上限 8，超出报错；父 `signal` 中止级联到所有子 run，不发通知。
- 计量：子 usage 累加进父 `RunResult.usage`。
- 事件：子 session 的全部事件包装为 `subagent_event { agentId, description, subagentType, event }` 经父 `onEvent` 发出；tool result `details` 带 `{ agentId, childSessionId }`。
- 列表：带 `parentSessionId` 的 session 不出现在 TUI resume 列表和 `--resume` 里。
- Headless CLI：stream-json 输出 `subagent_event`，text 模式只输出父代理最终文本。
- TUI：本工单只用通用工具卡展示。

新建 `subagents/` 概念目录。

Blocked by: None (can start immediately)

Status: resolved

参考：[spec](../spec.md)「Agent Core：新模块 `subagents/`」「模型工具」「父 run 等待与结束通知」「usage」「Session API 与事件」「Headless CLI」。

- [x] e2e：后台返回 id，父 run 等待子代理，通知文本与送达时机（父在跑时 steer、父已停下时开启下一次模型调用）
- [x] e2e：前台返回最终文本；失败时 `isError` 且无通知
- [x] e2e：同一回复里并行多个 `subagent`；第 9 个报错；子代理工具集无 `subagent`
- [x] e2e：父 `signal` 中止级联，无通知；usage 累加；`subagent_event` 的包装与顺序；子 session 不在过滤后的列表里
- [x] CLI：stream-json 含 `subagent_event`；text 模式只有父代理最终文本
- [x] `CONTEXT.md` 术语一致；`tsc -b` 与全量 `bun test` 通过

## Comments

- 2026-10-04: Implemented the minimum general-purpose Subagent lifecycle in `subagents/`, reusing the existing Session and pi Agent loop. Child creation persists `parentSessionId`; public parent/child events retain their own session ids. Parent Runs wait for child storage closure and notification delivery; `subagents_waiting` exposes that interval for the later TUI ticket.
- Public `createSession` tests cover background/foreground success and failure, active-parent steering versus stopped-parent continuation, eight concurrent children and the ninth-call error, depth restriction, last nonempty closing text, fixed provider usage accumulation, parent cancellation cleanup and a subsequent Run. Explicit deny/ask rules still apply to the new mode-safe delegation tool.
- CLI tests cover text/stream-json output and child `--resume` rejection; TUI terminal tests cover child `--resume` rejection. There is currently no separate TUI resume picker/list caller; the central Session metadata filter covers both existing frontend resume paths.
- Verification: `rtk proxy env -u NO_COLOR bun run check` exited 0: formatting, lint, `tsc -b`, knip, and **997 tests / 5433 assertions / 72 files** passed in 111.66s. The isolated baseline previously passed 984 tests. Existing CLI metadata expectations were updated to include the new tool; TUI narration retained one initial System Prompt by registering Subagent in the initial tool baseline.
- Independent `/code-review` axes against `f3a387d846c097e9234c30b341d3dcbb68b3ac40`: **Standards 0 findings; Spec 0 findings**. `CONTEXT.md` already defines Subagent and the parent Run completion contract, so no terminology changes were needed. CodeGraph had a directory but reported no usable worktree index; source navigation used the permitted fallback.
- Tickets 03–06 retain ownership of live permission sharing/origin, types/model configuration, fork/send/list/Tool State/interruption, and dedicated TUI presentation.
