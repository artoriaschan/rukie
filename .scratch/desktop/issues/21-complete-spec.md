# 21: 补全 spec 并切分实现工单

Type: grilling

Blocked by: 20

Status: needs-triage

## Question

01–20 已结题。按 `/to-spec` 补全 [spec.md](../spec.md)：架构与包边界、wire 协议、sidecar 生命周期、本地 macOS 构建、测试与交付规则、已知限制，以及 Not yet specified 中留给 spec 的细节（桌面端注册表位置与格式、默认工作区目录、Session 空闲关闭宽限期、sidecar 重启超时与次数、停止 sidecar 的宽限期）；逐项确认主窗口布局「待定」中的入口；起草 [20](20-adr-list.md#answer) 定下的四个 ADR 并更新 ADR-0001、ADR-0003、ADR-0004、ADR-0012；填写 `## ADR Coverage`；按依赖顺序切出实现工单，第一批为 Agent Core 前置改动（busy 错误带 code、`list()` 按目录容错、公开 Queued Input，方向见 05、10、12）。地图 Not yet specified 的其余各项在此归入 spec 或对应实现工单的验收。
