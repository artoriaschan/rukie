# 17: 文件外部修改检测

Type: grilling
Status: resolved
Blocked by: None

## Question

模型读过的文件被用户或其他进程改了，如何作为 reminder 告诉模型？

需定：跟踪哪些文件（read 过的 / 写过的）；检测时机（每个 turn 开始比对 mtime / 内容哈希，或文件监听）；reminder 内容（只提示已变 / 附 diff），大小上限；与现有 reminders 机制的接入；跨 resume 是否保留跟踪集。

## Answer

2026-10-05 grilling 结论。参考：Claude Code 的 changed-file 片段与 Edit/Write 的 "file modified since read" 检查；现有 `reminders/` 的 `ReminderSource` 与 `session/index.ts` 中 `planReminder` 的请求前注入路径。

1. **跟踪集：** `read` / `write` / `edit` 碰过的文件；写入后基线更新为写后内容（模型认知即写后版本，hook formatter 等改动同样要报）。bash 不跟踪。
2. **检测时机：** 每次模型请求前，走 `planReminder` 同一路径（同 run 内 hook formatter、bash codegen、子代理写入都能捕获）。先比 mtime+size，变了再比内容哈希。不用文件监听。
3. **reminder 内容：** 新 `ReminderSource` `file-changes`，附 unified diff；单文件 4K 字符、总量 16K，超限文件只列路径并提示重读。文件被删报"已删除"并移出跟踪集。
4. **写入前过期检查：** edit / write 前比对基线，读后被外部改过则返回工具错误、要求重读，防止同 turn 内覆盖外部改动。未读过的文件仍允许 write（新建场景）。位置：地基 C 放行后阶段或 `adaptTool` 的 execute，实现时择一。
5. **持久化：** Tool State `file-tracking` 存 `{ path, mtime, size, hash }`；旧内容只在内存。resume 后检测到变化只报"已变更"、不附 diff，模型自行重读。
6. **compaction：** 跟踪集保留，照常报 diff。CC 式 compaction 后重新附上最近读过的文件不做（Out of scope）。
7. **子代理 / rewind：** 子代理独立跟踪集；子代理写了父读过的文件，父下次请求前按外部修改报出。rewind 恢复的文件同样按外部修改处理；回退对话时跟踪集随 Tool State last-wins 快照回退，与对话一致。无特殊逻辑。
8. **frontend：** 不额外呈现，现有 `reminder_injected` 事件足够。Headless CLI 不变。

Spec：[文件外部修改检测 spec](../../file-change-detection/spec.md)（ready-for-agent）。
