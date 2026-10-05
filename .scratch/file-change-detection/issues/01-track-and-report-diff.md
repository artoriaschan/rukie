# 01: 跟踪已读写文件，请求前报 diff

**What to build:** 模型 read / write / edit 过的文件被外部改动后，下一次模型请求前收到一条 `file-changes` system reminder，附 unified diff；文件被删时告知已删除。agent 自己的写入不被报告。跟踪集此时只在内存。详见 [文件外部修改检测 spec](../spec.md) 的跟踪对象、接入点、基线内容、检测、报告规则（diff 与删除部分）、reminder 文本、差异生成几节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 新领域模块 `file-tracking` 独占跟踪集与基线；包装 read / write / edit 的 execute，成功执行后以磁盘完整内容为基线（read 带 offset/limit 也记整文件），失败不更新
- [ ] 新 `ReminderSource` `file-changes`，同时接入 prompt 开始的 `collectReminders` 与每次请求前的 `collectSourceReminders` 路径
- [ ] 检测先比 mtime+size，变了再比 SHA-256；内容不变只刷新元数据、不报告
- [ ] 有变化时附 3 行上下文 unified diff，并把基线更新为新内容；同一变化只报一次
- [ ] 文件不存在报"已删除"并移出跟踪集
- [ ] reminder 中路径按工具展示方式（cwd 内相对路径），文本英文
- [ ] 直接依赖 `diff` 精确钉 `8.0.4`，更新 `docs/tech-stack.md` 与 lockfile
- [ ] e2e：read 后外部改 → 报 diff；不重复；无变化无 reminder；`touch` 无 reminder；同 run 内 bash 改已读文件即报；write / edit 自身写入不报，写后外部再改则报；删除报一次后不再报
