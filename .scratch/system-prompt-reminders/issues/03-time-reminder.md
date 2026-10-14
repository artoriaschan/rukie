# 03：时间提醒

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#时间提醒工单-03)，`date` 改名 `time`，给出完整时间并在空闲 2 小时或跨日时刷新。

- [ ] 格式、开场与 Compaction 后完整快照
- [ ] 空闲刷新与跨日刷新，同日不刷新
- [ ] 测试：注入时钟覆盖阈值前与阈值时、跨日、Compaction、Resume；固定 `TZ`
- [ ] 文档：`docs/architecture.md` 提醒来源

## Comments
