Status: ready-for-agent

# Spec: 文件外部修改检测

来源：[文件外部修改检测](../agent-core-roadmap/issues/17-external-file-change-reminder.md)；依赖 [地基 B：工具状态进 transcript](../agent-core-roadmap/issues/02-tool-state-in-transcript.md)（Tool State）、[地基 C：工具调用前后拦截点](../agent-core-roadmap/issues/03-tool-call-interception.md)（放行后阶段）。术语见 `CONTEXT.md` 的 System Reminder、Tool State、Compaction、Run、Turn。参考：Claude Code 的 changed-file 片段与 Edit/Write 的 "file modified since read" 检查。

## Problem Statement

agent 读过一个文件后，我在编辑器里改了它，或者 formatter、codegen、子代理、hook 改了它，agent 并不知道。它仍按旧内容推理，给出过时的结论；更糟的是，它用旧的 `oldText` 去 edit 失败，或者用 write 整文件覆盖，把我刚做的改动悄悄冲掉。resume 一个昨天的 session 时也一样：中间我改过的文件，agent 全当没变。

## Solution

Agent Core 记住模型读过和写过的文件。每次请求模型前检查这些文件是否被外部改动；有改动就附一条 system reminder，带上 diff（太大时只列路径，请模型重读），被删的文件明确告知已删除。模型要 edit / write 一个读后被外部改过的文件时，工具直接报错，要求先重读，绝不覆盖外部改动。跟踪集随 session 持久化，resume 后仍能发现期间的改动。用户不需要做任何事，frontend 也没有新界面。

## User Stories

1. As a developer, I want the agent to learn that a file it read was changed in my editor, so that it doesn't reason from stale content.
2. As a developer, I want the change shown as a diff, so that the agent sees exactly what I changed without re-reading the whole file.
3. As a developer, I want large changes to fall back to "changed, please re-read", so that a big rewrite doesn't flood the context.
4. As a developer, I want the total size of change reminders capped, so that a branch switch touching many tracked files doesn't blow up the context.
5. As a developer, I want the agent told when a file it read was deleted, so that it doesn't try to edit a file that no longer exists.
6. As a developer, I want a deleted file to stop being tracked, so that it isn't reported again on every request.
7. As a developer, I want a file the agent wrote to be tracked at its post-write content, so that later external changes to it are detected.
8. As a developer, I want the agent's own writes not reported back as external changes, so that it isn't confused by its own edits.
9. As a developer, I want changes made by a formatter in a PostToolUse hook to be reported, so that the agent's next edit uses the formatted text.
10. As a developer, I want changes made by a bash command (codegen, `git checkout`) to tracked files to be reported, so that the agent notices side effects of its own commands.
11. As a developer, I want detection to happen before every model request, not only at the start of a prompt, so that changes within a single run are caught.
12. As a developer, I want an unchanged file to never produce a reminder, so that the context isn't padded with noise.
13. As a developer, I want a file whose mtime changed but content didn't (e.g. `touch`) to not be reported, so that only real changes show up.
14. As a developer, I want a change reported once, so that the same diff doesn't repeat on every request.
15. As a developer, I want a file changed twice between requests reported as one diff against what the agent last knew, so that the agent gets the net change.
16. As a developer, I want edit to fail when the file was changed externally since the agent last read it, so that my change is never overwritten.
17. As a developer, I want write to fail in the same case, so that a whole-file overwrite can't clobber my edits.
18. As a developer, I want the failure to tell the model to re-read the file, so that it recovers on its own.
19. As a developer, I want write to a file the agent never read to still work, so that creating new files isn't blocked.
20. As a developer, I want edit after the agent re-reads the changed file to succeed, so that the guard doesn't get stuck.
21. As a developer, I want a change that was already reported via reminder to count as known, so that edit isn't blocked once the agent has seen the diff.
22. As a developer, I want the tracking set kept across resume, so that changes I made while the session was closed are reported.
23. As a developer, I want changes found after resume reported as "changed, please re-read" without a diff, so that the session file doesn't have to store file contents.
24. As a developer, I want edit / write after resume to apply the same stale-file guard, so that resuming doesn't open an overwrite hole.
25. As a developer, I want tracking to continue after compaction, so that changes are still reported when the agent only has a summary.
26. As a subagent user, I want each subagent to have its own tracking set, so that subagents follow the same rules independently.
27. As a developer, I want the parent agent told when a subagent changed a file the parent had read, so that the parent doesn't work from stale content after delegation.
28. As a developer, I want files restored by rewind to be reported as external changes when the conversation is kept, so that the agent knows the code was rolled back.
29. As a developer, I want rewind that rolls back the conversation to also roll back the tracking set, so that tracking matches what the agent saw at that point.
30. As a developer, I want paths in reminders shown the same way the tools show them, so that the agent can pass them straight back to read.
31. As a developer, I want unreadable files (permission denied mid-session) reported as changed rather than crashing the run, so that detection never breaks a Run.
32. As a developer, I want binary or non-UTF-8 files to be reported without a diff, so that garbage bytes don't enter the context.
33. As a stream-json consumer, I want change reminders to show up as the existing `reminder_injected` event, so that I can observe them without a new event type.
34. As a TUI user, I want no extra UI noise, so that the conversation view stays as it is.
35. As a Headless CLI user, I want the same detection and guard, so that scripted runs are equally safe.
36. As a developer, I want detection to cost only a stat per tracked file when nothing changed, so that long sessions with many reads stay fast.
37. As a developer, I want a corrupted tracking record skipped with a warning, so that a bad session entry doesn't block resume.
38. As a maintainer, I want detection to reuse the existing reminder and Tool State mechanisms, so that there is one injection path and one persistence path.
39. As a maintainer, I want the guard and baseline updates in one module, so that read, write, and edit stay consistent.

## Implementation Decisions

- **新模块 `file-tracking`**（Agent Core 一个领域目录），独占跟踪集、基线、过期检查与 reminder 渲染。Session 只负责接线。
- **术语**：被跟踪的文件叫 Tracked File；它的基线是 agent 对该文件内容的最后认知。实现内部命名，不进 `CONTEXT.md`（不是用户可见概念）。
- **跟踪对象**：`read`、`write`、`edit` 成功执行后，把目标文件记入跟踪集，基线为执行后磁盘上的完整内容（即使 read 带 offset/limit，也记整个文件）。bash、glob、grep 不记。路径按工具已有的解析方式（`prepareFileToolPath` + cwd）得到绝对路径作键；reminder 中以工具展示路径的同样方式显示（cwd 内用相对路径）。
- **接入点：包装三个文件工具的 execute**，在现有 `adaptTool` 适配的同一层。执行前：write / edit 做过期检查；执行成功后：更新基线。不放在地基 C 的放行后阶段，因为那里只在执行前、拿不到执行结果。工具失败时不更新基线。
- **基线内容**：内存里存 `{ path, mtimeMs, size, hash, content?, stale }`。`content` 只在内存，用于生成 diff；`hash` 为内容 SHA-256。
- **检测**：在每次模型请求前、`plan-mode` reminder 同一处（请求前的 `collectSourceReminders` 路径）比对，作为新 `ReminderSource` `file-changes`，同时纳入 prompt 开始时的 `collectReminders`。对每个跟踪文件先 `stat`：mtime 与 size 都没变则跳过；变了再读内容比 hash，hash 不变只刷新 mtime/size，不报告。
- **报告规则**：
  - 有旧内容、新内容是 UTF-8 文本、diff ≤ 4,000 字符：附 unified diff；基线更新为新内容（模型已看到改动），`stale` 不变。
  - 无旧内容（resume 后）、diff 超 4K、累计超过总量 16,000 字符、内容非 UTF-8 文本、或读取失败：只列路径，提示"已在外部修改，修改前请重新 read"；基线 hash/mtime/size 更新为当前值（不重复报告），`stale: true`，`content` 丢弃。
  - 总量上限按每次模型请求计入新增 `file-changes` 内容，包含 reminder 标题、分隔符、diff 与路径提醒；prompt 开始收集与请求前收集共享预算，完成请求准备后重置，不限制已有 Transcript 历史。若仅路径提醒也超过 16,000 字符，按跟踪顺序分批报告；未报告文件不更新基线、不移出跟踪集，后续请求继续检测和报告，避免把模型尚未看到的变化当作已知。
  - 文件不存在：报"已删除"，移出跟踪集。
  - 无任何变化时 source 返回 undefined。每次的 reminder 内容都不同，现有按来源去重不会吞掉连续两次报告；同一变化只报一次，靠基线更新保证。
- **reminder 文本**（英文，Agent Core 不本地化）：一条 `file-changes` reminder，开头说明"以下文件在你上次读取或写入后被修改（用户、hook、命令或其他 agent）"，然后逐文件分段：diff 段、路径列表段、已删除段。
- **过期检查**：write / edit 执行前，若目标在跟踪集中且 (`stale` 为真，或当前 hash 与基线不同)，返回工具错误："File has been modified since it was last read. Read it again before editing."，不执行写入。目标不在跟踪集中（从未读写过）时 write 照常；edit 照常交给 pi（pi 自身会因 `oldText` 不匹配报错）。read 清除 `stale` 并重置基线。
- **差异生成**：直接依赖 `diff`，精确钉 `8.0.4`（与 pi-agent-core 已用版本一致），用其 unified patch 函数，上下文 3 行。更新 `docs/tech-stack.md` 与 lockfile。
- **持久化：Tool State `file-tracking`**，version 1，值为 `{ files: Array<{ path, mtimeMs, size, hash, stale }> }`，TypeBox 校验，last-wins，坏记录按地基 B 跳过并告警。不存 `content`。基线每次变化（工具执行后、报告后、删除移出）写一份完整快照。不提供 `renderReminder`：reminder 由检测产生，不由快照渲染。
- **报告保存顺序**：diff、只列路径与删除报告都在对应 reminder 成功写入 Transcript 后才提交新基线或移除跟踪记录。保存前写入旧基线与保守的 `stale: true`，未送达的变化保持可检测；保存失败后同进程重试或 resume 继续报告。工具成功更新基线仍在 PostToolUse 前完成。prompt 收集与请求准备共享的预算在 Run 失败清理时也重置。
- **resume**：从 Tool State 恢复跟踪集（无 `content`），下一次检测发现的变化走"只列路径 + stale"分支。
- **compaction**：跟踪集与内存 `content` 都保留，compaction 后照常报 diff。compaction 后的 reminder 重注入不重放 `file-changes`（它反映的是事件，不是状态），实现上：source 无变化即返回 undefined，自然不会重注入。
- **rewind**：回退对话时，Tool State 按现有 `restore` 投影回退，跟踪集同步；内存 `content` 对不上恢复后的快照时丢弃（hash 不同的条目丢弃 content）。只回退代码时，恢复的文件在下次请求前按外部修改报告。
- **子代理**：子 session 自有跟踪集（独立 session、独立 Tool State），父不感知子的读取。子写入父跟踪的文件，父下一次请求前按外部修改报告。
- **frontend**：无新事件、无新 API；改动经 `reminder_injected { source: "file-changes" }` 可观察。TUI 与 Headless CLI 均不改。
- **失败行为**：检测中单个文件的 stat/read 错误（非 ENOENT）按"只列路径 + stale"处理，不抛出、不中断 Run。

## Testing Decisions

- **好测试**：只测外部行为。观察对象是模型请求中的 `file-changes` reminder 文本、`reminder_injected` 事件、write / edit 的工具结果与磁盘内容、resume 后的行为。不测 hash、stat 比较或基线结构。
- **唯一测试接缝：Agent Core e2e**（`bun:test`，`packages/agent/tests/e2e/file-changes.test.ts`），`createSession` + `fakeModel` 脚本化工具调用 + `tempDirs` 隔离 cwd 与 `homeDir`。测试在两次模型回复之间直接改磁盘文件；改后用 `utimes` 显式推进 mtime，避免同毫秒写入。不新增注入点。覆盖：
  - read 后外部修改 → 下一次请求带 diff；同一变化不再重复；无变化无 reminder；`touch`（mtime 变、内容不变）无 reminder。
  - 同 run 内：bash 工具改了已读文件 → 同 run 下一次请求即报告。
  - write / edit 自身写入不被报告；写后外部再改则报告。
  - diff 超单文件上限只列路径；多文件超总量后余下只列路径；二进制文件只列路径。
  - 删除 → "已删除"，之后不再报告。
  - 过期检查：read 后外部改、未经报告即 edit / write → 工具错误、磁盘内容保持外部版本；diff 报告后 edit 成功；只列路径报告后 edit 仍被拒，re-read 后成功；从未读过的新文件 write 成功。
  - resume：关闭 session、改文件、重建 session → 首次请求报"已修改，请重读"且无 diff；随后 edit 被拒，read 后成功。
  - compaction 后仍报 diff。
  - 子代理写入父已读文件 → 父下一次请求报告。
  - rewind 只回退代码 → 恢复的文件被报告。
- **参考先例**：`tests/e2e/todo-reminders.test.ts`（reminder 注入与 resume）、`tests/e2e/checkpoint.test.ts` 与 `checkpoint-subagents.test.ts`（文件工具写入、rewind、子代理写入归属）、`tests/e2e/compaction.test.ts`（compaction 后注入）。
- 不加 Headless CLI 与 TUI 测试：无 frontend 呈现。

## Out of Scope

- bash 读写的文件进入跟踪集（无法可靠识别 bash 触及的文件）。
- 文件监听（fs watch）。
- compaction 后重新附上最近读过的文件（CC 做法）。
- resume 后附 diff（需持久化文件内容）。
- TUI 呈现"N 个文件被外部修改"。
- glob / grep 结果的过期检测。

## Further Notes

- 4K / 16K 上限是初值，按实际使用调整，不做配置项。
- edit 的过期检查与 pi 自身 `oldText` 匹配是两层：前者保护"内容碰巧仍匹配但上下文已变"的情况，以及 write 整文件覆盖。
