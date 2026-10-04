# 05: `Session.dispose()` 与 SessionEnd

**What to build:** frontend 退出时有统一的收尾点，SessionEnd hook 能在这里做清理，且不拖慢退出。见 [spec](../spec.md)「接入：Session 生命周期」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `Session.dispose(reason?: "exit" | "other")` 幂等：中止进行中的 run、触发 SessionEnd、关闭 MCP 连接。
- [ ] SessionEnd 输入带 `reason`，matcher 匹配 `reason`；所有 hook 共享 1.5s 总预算；输出丢弃。
- [ ] TUI 退出、Headless CLI 结束时调用 `dispose()`。
- [ ] Agent Core e2e：触发 SessionEnd、重复调用只触发一次、MCP 子进程被关闭；预算用小 `timeout` 测一条。
