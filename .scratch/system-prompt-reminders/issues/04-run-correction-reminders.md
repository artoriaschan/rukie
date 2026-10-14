# 04：运行纠偏提醒

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#运行纠偏工单-04)，新增重复调用、无进展、工具调用上限与输出截断续写提醒。

- [ ] 重复调用 3/5/8、无进展 15/25/40 分级提醒，进展事件重置
- [ ] 工具调用上限总结提醒
- [ ] `length` 截断续写最多 3 次，无可见输出时的重试提醒
- [ ] 测试：阈值前后、计数重置、续写上限、Compaction 与 Resume 后清零

## Comments
