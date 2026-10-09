# 01: Request Ledger

**What to build:** 新建 `src/requests/`，接管 `session/index.ts` 中 Request 身份铸造与识别、`RequestDoc`、`registerSubmission`、`resultFor`、`requestCausesForTasks`、`requestWaiters`、`currentRequestId` 及启动恢复重建。Session 公开接口不变。详见 [spec](../spec.md)。

Blocked by: None (can start immediately)

Status: ready-for-agent

- [ ] Session 内不再有 Request ID 的 `startsWith`/正则解析
- [ ] 字符串编码与 `RequestDoc` 格式不变，已有恢复 e2e 通过
- [ ] `tests/requests/` 用内存 Storage 覆盖身份、因果与结算
- [ ] 结果组装为纯函数，Goal 与 Subagent 回执规则可直测
- [ ] hook stop 与 plan takeover 的 4 处首输入写入收敛为 Ledger 的事务内写入
- [ ] 等价 e2e 断言迁移，保留每条恢复路径一个冒烟用例
