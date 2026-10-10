---
status: accepted
---

# 桌面端与 TUI 共用 JSONL Session store，项目与置顶由桌面端注册表维护

## 问题

[ADR-0003](0003-dual-session-store.md) 原定桌面端使用基于 `bun:sqlite` 的独立 Session store。[ADR-0024](0024-adopt-pi-durable-harness.md) 之后，Session 存储改为 pi-durable 的原生 JSONL Storage，SQLite 只持有写者 lease。桌面端需要决定 Session 存在哪里，以及项目列表、置顶这类桌面端专有的状态由谁持久化。

## 决定

桌面端 server 直接使用 Agent Core 默认的 JSONL Session store，与 TUI 和 Headless CLI 共用同一目录。各端互相能看到对方创建的 Session，并共享按 Session 粒度的单写者 lease：同一个 Session 同时只能被一个进程打开，后到者收到带 code 的 busy 错误，server 映射为 `session_busy`。

项目列表、置顶的 Session、默认工作区目录与侧栏偏好由桌面端注册表维护，保存在 `homeDir/.rukie/desktop/` 下，由 server 独占读写。Agent Core 与 store 的格式不变，不新增项目或置顶的概念。

本决定整份替代 ADR-0003：其 JSONL 选型已由 ADR-0024 保留，桌面端 SQLite store 由本决定推翻。规划依据见[桌面端地图](../../.scratch/desktop/map.md)的 05 与 10。

## 备选方案

- 桌面端独立的 SQLite store（ADR-0003 原方案）：TUI 与桌面端无法互见 Session，还要实现第二套存储并履行同样的恢复义务。
- 把项目与置顶写进 Agent Core 或 Session 索引：让 Agent Core 承担只有桌面端需要的概念，并改变 store 格式。

## 影响

TUI 与桌面端可以接力同一个 Session，但不能同时打开它。桌面端注册表只是桌面端的视图状态，删除它不会丢 Session。实施工单见[桌面端 spec](../../.scratch/desktop/spec.md)。
