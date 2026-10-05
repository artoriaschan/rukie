# 03: 写入前过期检查

**What to build:** 模型 edit / write 一个读后被外部改过、尚未看到改动的文件时，工具返回错误要求先重读，磁盘上的外部改动保持不变。看过 diff、或重读之后可以正常写；从未读过的新文件照常 write。详见 [文件外部修改检测 spec](../spec.md) 的过期检查一节。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] write / edit 执行前：目标在跟踪集中且（`stale` 或当前 hash ≠ 基线）时返回 "File has been modified since it was last read. Read it again before editing."，不执行
- [ ] read 清除 `stale` 并重置基线
- [ ] 不在跟踪集中的文件：write 照常，edit 交给 pi 原有行为
- [ ] e2e：read → 外部改 → 未报告即 edit / write 被拒且磁盘为外部版本；diff 报告后 edit 成功；只列路径报告后 edit 仍被拒，re-read 后成功；新文件 write 成功
