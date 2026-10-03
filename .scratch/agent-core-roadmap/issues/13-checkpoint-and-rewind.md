# 13: 撤销改动 / checkpoint

Type: grilling
Status: open
Blocked by: 02, 03, 05

## Question

把 agent 改过的文件回滚到某一轮之前，以及与对话回退（rewind / fork，JSONL 已是树结构）的关系。

需定：快照时机（写工具前经地基 C 拦截 / 每轮开始）；存储（影子 git / 文件副本）与清理；bash 造成的改动是否覆盖；回滚代码与回退对话是否联动（只回代码 / 只回对话 / 都回）；快照引用按地基 B 记入 transcript；TUI 交互入口（Slash Command / 快捷键）；`CONTEXT.md` 术语（Checkpoint）。
