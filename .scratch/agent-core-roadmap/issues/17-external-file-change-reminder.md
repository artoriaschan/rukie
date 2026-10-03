# 17: 文件外部修改检测

Type: grilling
Status: open
Blocked by: None

## Question

模型读过的文件被用户或其他进程改了，如何作为 reminder 告诉模型？

需定：跟踪哪些文件（read 过的 / 写过的）；检测时机（每个 turn 开始比对 mtime / 内容哈希，或文件监听）；reminder 内容（只提示已变 / 附 diff），大小上限；与现有 reminders 机制的接入；跨 resume 是否保留跟踪集。
