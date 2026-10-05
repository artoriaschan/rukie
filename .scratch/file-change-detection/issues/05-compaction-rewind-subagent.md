# 05: compaction、rewind、子代理场景

**What to build:** 跟踪在 compaction 后照常工作；rewind 只回退代码时恢复的文件被报告，回退对话时跟踪集随之回退；子代理写入父已读的文件时，父下一次请求前被告知。详见 [文件外部修改检测 spec](../spec.md) 的 compaction、rewind、子代理三节。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] compaction 后跟踪集与内存内容保留；`file-changes` 不在 compaction 后重注入
- [ ] rewind 回退对话：Tool State 投影回退后，hash 与快照不符的内存内容丢弃
- [ ] e2e：compaction 后外部改 → 仍报 diff
- [ ] e2e：rewind 只回退代码 → 恢复的文件下一次请求前被报告；回退代码+对话 → 跟踪集与回退点一致，无误报
- [ ] e2e：子代理 write 父已读文件 → 父下一次请求报告
