# 13: 撤销改动 / checkpoint

Type: grilling
Status: resolved
Blocked by: 02, 03, 05

## Question

把 agent 改过的文件回滚到某一轮之前，以及与对话回退（rewind / fork，JSONL 已是树结构）的关系。

需定：快照时机（写工具前经地基 C 拦截 / 每轮开始）；存储（影子 git / 文件副本）与清理；bash 造成的改动是否覆盖；回滚代码与回退对话是否联动（只回代码 / 只回对话 / 都回）；快照引用按地基 B 记入 transcript；TUI 交互入口（Slash Command / 快捷键）；`CONTEXT.md` 术语（Checkpoint）。

## Answer

1. **范围：** 代码回滚与对话回退同一入口、两套机制。对话回退 = 移动 pi `branchTip` 到目标 user prompt 之前（原分支保留）；代码回滚 = 还原 Checkpoint。用户三选一：回代码 + 对话 / 只回对话 / 只回代码。
2. **快照机制（照 CC file history）：** 挂地基 C 的放行后阶段，每个 Checkpoint 内某文件首次被文件工具写入前存一份副本；被拒调用不留快照。不覆盖 bash，不做整树影子 git、不做 bash 前后扫描。
3. **粒度：** 每条 user prompt 一个 Checkpoint，与对话回退锚点一致；Goal 续跑、Stop hook 续跑同属该 run，不另开。
4. **子代理：** 子代理的写入记进父 session 当前 Checkpoint；回滚父 session 一并还原。子 session 无 rewind 入口。
5. **存储：** 副本在 `~/.neant/file-history/<sessionId>/`，按内容 hash 存；启动时清理超 30 天的。Checkpoint 引用（prompt entry id → 文件路径 + 备份 hash，或"原本不存在"）作为 Tool State `checkpoint` 记入 transcript。
6. **TUI 入口：** `/rewind` 与空输入框双击 Esc（run 中双击 Esc 仍为中止）。面板界面、样式、交互照 dsh-TUI `RewindPicker`（停靠输入框下方、新到旧单行预览、3000ms 双击窗口），详见 [spec](../../checkpoint/spec.md)。列出本 session user prompt，每行附改动文件数；选中后选三种回退或取消。命令框架归 Slash Command 工单。
7. **回退后：** 被回退的 prompt 文本填回输入框。
8. **冲突：** 不检测，直接覆盖成快照内容；Checkpoint 前不存在的文件删除。确认界面列出将还原 / 删除的文件，并提示 bash 改动不会还原。
9. **时机：** 仅 session 空闲（无 run、无 running 子代理）可 rewind。
10. **跨 compaction：** 允许；新分支上不含之后的摘要，恢复压缩前状态，后续交给自动 compaction。
11. **API：** Session 暴露 `checkpoints()`（prompt entry id、预览、改动文件）与 `rewind(entryId, { code, conversation })`。Tool State（todo、plan、goal 等）last-wins，随分支自然恢复。Headless CLI 不提供，可用 resume + fork 代替。
12. **术语：** `CONTEXT.md` 新增 Checkpoint、Rewind。
