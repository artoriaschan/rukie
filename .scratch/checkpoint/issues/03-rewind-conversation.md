# 03: 回对话与两者都回

**What to build:** `rewind` 支持 `conversation: true`：把 transcript 的 main 分支指针移到目标 user 消息 entry 的 parent（原分支保留），并在内存中按新分支重建 messages、Tool State（todo、plan、goal、checkpoint）与 compaction 状态，效果等价于对该点 resume，但不新建 Session。返回被回退的 prompt 文本。两者都回时先回代码，代码失败则对话不动。只有真实 user prompt 开 Checkpoint。见 [spec](../spec.md)"Checkpoint 锚点 / 回对话"。

**Blocked by:** 02

**Status:** resolved

- [x] 只回对话：`messages` 与 `toolState()` 立即反映新分支，发出相应状态事件（如 `tool_state_changed`、plan mode 变化）
- [x] 文件不变；回退后继续 run 从新位置接着建 Checkpoint，可反复回退
- [x] 两者都回：代码与对话同时回到目标；回代码失败时对话不变
- [x] 目标在 compaction 之前也可回，新分支不含之后的摘要
- [x] hook autorun、Goal 续跑、Stop 续跑、子代理完成通知不开新 Checkpoint，也不出现在 `checkpoints()` 中
- [x] 返回值含 prompt 文本
- [x] e2e 测试覆盖以上，含 resume 后回对话

## Answer

已完成回对话及两者都回。`rewind(promptEntryId, { code, conversation })` 返回 `{ prompt, restored, deleted }`；回对话把 main 移到目标真实 user entry 的 parent，同时保存原 tip 为独立 transcript 分支。初始化 / resume 与原地 rewind 共用模块内纯 `projectBranch`，重建消息、prompt 索引、reminder 起点与 baseline；重放已注册 Tool State 后，todo reminder、Plan Mode、checkpoint 与子代理身份的内存投影立即一致，原 Map / 数组闭包保留。回代码与对话时先验证并恢复文件，代码失败不移动分支。

恢复时清除旧分支的待广播 Plan 事件，以及 compact SessionStart 等待下一条 user 的待注入上下文，重置 context usage 的 provider 计数。订阅者收到变化的 `tool_state_changed`（清除为 `value: undefined`）、`conversation_rewound` 与重算 `context_usage`；06 在事件边界读取 `session.messages` 即可重放。旧 child Session 仍保存在 Session 的资源集合中，最终由 dispose 关闭。Goal 当前尚无实现及公开续跑 seam，本工单保持真实 prompt 的身份判定及通用 Tool State 重放，不新增 Goal 功能。

- 实现提交：`0e55577`；审查后共享投影重构：`64746e4`。
- focused checkpoint / compaction / compaction-hooks / hooks / async-hooks / plan-mode / subagents：124 pass / 0 fail，635 expect，7 files；`bunx tsc -b` exit 0。
- 最终固定源码树全套：隔离临时 HOME，`env -u NO_COLOR caffeinate -is bun run check` exit 0；1495 pass / 0 fail，7737 expect，111 files，170.13s；format、lint、typecheck、knip 全通过。日志 `/tmp/neant-checkpoint03-review-check.log`。
- code-review 固定点 `75f8559509ef5955af64271b4dbffe3292f01aae`：初次 Standards 0 hard violation、1 possible 低优先级 Duplicated Code，Spec 0 findings；抽取共享纯分支投影后 Standards 0 remaining findings，Spec 0 missing / scope / incorrect findings。Spec 独立 checkpoint / compaction-hooks / subagent-fork 验证 43 pass / 0 fail，284 expect，并核实 pi 初始化复制 messages 数组，无 alias 回归。

## Comments

2026-10-05：实现与验证已准备好，等待统一的 Standards / Spec 两轴独立审查；本工单保持 claimed，审查后再填写 resolved 证据。

- `rewind(..., { conversation: true })` 保留旧 tip 为独立 transcript 分支，并把 main 移到目标 user entry 的 parent。在同一 Session 中重放 messages、已注册 Tool State、todo reminder、Plan Mode、checkpoint、子代理身份与 compaction 状态；Tool State 的动态闭包保留，后续 prompt 写入会从恢复后的 checkpoint 状态继续。
- 两者都回先恢复文件，备份缺失时对话不动；只回对话不改磁盘。广播变化的 `tool_state_changed`，清除状态用 `value: undefined`，随后广播 runtime-agnostic `conversation_rewound`（含 promptEntryId）及重算的 `context_usage`。事件发出时公开 Session 状态已完整更新，06 可直接从 `session.messages` 重放。CLI 的通用 stream-json 订阅无需额外事件分支。
- 所有已注册 Tool State 走统一重放；当前仓库未实现 Goal 及其公开续跑 seam，本工单不添加 Goal 功能。真实 prompt 判定复用 02 的对象身份边界，新增公开回归覆盖 autorun、Stop continuation、subagent / subagent_fork 完成通知的排除。旧 child Session 仍由 Session 的 `childSessions` 资源集合持有并负责 dispose。
- TDD 经 `createSession` / Session 公开 seam：初始 conversation rewind 测试先因 API 未实现失败；子代理 registry 先因旧身份未清除失败；compact SessionStart 待注入上下文先因跨分支泄漏失败，分别修复。跨 compaction 的 live / resume、旧分支保留、todo / Plan Mode 恢复、新位置继续写入并再次回退、组合恢复顺序、三种模式忙态拒绝均有回归。
- focused：checkpoint 25 pass / 0 fail；checkpoint、plan-mode、subagents、compaction 共 66 pass / 0 fail；最终补充 compact hook 泄漏回归后 checkpoint + compaction-hooks 37 pass / 0 fail，`bunx tsc -b` exit 0。
- 最终固定源码树完整检查：隔离临时 HOME，`env -u NO_COLOR caffeinate -is bun run check` exit 0，1495 pass / 0 fail，7736 expect，111 files，170.52s；format、lint、typecheck、knip 均通过。日志 `/tmp/neant-checkpoint03-final-check.log`。
- code-review 固定点：`75f8559509ef5955af64271b4dbffe3292f01aae`；规格为本工单与 `.scratch/checkpoint/spec.md`，标准为 `CLAUDE.md`、`CONTEXT.md`、`docs/agents/domain.md`、`docs/agents/issue-tracker.md` 与 `docs/adr/0003-dual-session-store.md`。独立审查由父代理统一调度，结果待补。
