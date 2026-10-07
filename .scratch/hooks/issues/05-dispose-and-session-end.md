# 05: `Session.dispose()` 与 SessionEnd

**What to build:** frontend 退出时有统一的收尾点，SessionEnd hook 能在这里做清理，且不拖慢退出。见 [spec](../spec.md)「接入：Session 生命周期」。

Blocked by: 01

Status: resolved

- [x] `Session.dispose(reason?: "exit" | "other")` 幂等：中止进行中的 run、触发 SessionEnd、关闭 MCP 连接。
- [x] SessionEnd 输入带 `reason`，matcher 匹配 `reason`；所有 hook 共享 1.5s 总预算；输出丢弃。
- [x] TUI 退出、Headless CLI 结束时调用 `dispose()`。
- [x] Agent Core e2e：触发 SessionEnd、重复调用只触发一次、MCP 子进程被关闭；预算用小 `timeout` 测一条。

## Answer

- `Session.dispose()` 首次调用的 reason 生效；主动取消 Run 和 hook，独立执行 SessionEnd，并在 finally 等待当前 MCP 的幂等关闭入口。后续 Run 被拒绝；dispose 不等待任意异步事件观察者返回，因此观察者可以重入并等待 dispose。
- `hooks.dispose()` 取消所有非 SessionEnd hook 的生命周期 signal，供后续 async hook 复用。SessionEnd 使用独立的共享 1.5s 总预算，保留单条更短 timeout；stdout 和控制输出均丢弃。
- 执行错误和 timeout 同时发送 `onWarning` 与 `hook_warning`，后者沿最近 Run 的观察者发送且不等待观察者。退出码 3、单条 0.02s timeout、共享预算、慢 hook 取消、重入、reason 和重复调用均由公开 e2e 覆盖；真实 MCP PID 验证关闭。CLI 成功/失败与 TUI 空闲退出覆盖统一入口。
- Review：Standards 初审仅 P3 重复退出诊断逻辑，提取 `warnExit` 后复审 0 findings；Spec 独立审查与最新代码 HEAD `6288dae` 复核均 0 findings，公开 focused 92 pass / 374 assertions，issue 04 生命周期回归保持。
- Validation：2026-10-05 fresh 临时 HOME、移除 NO_COLOR，`bun run check` exit 0：1254 pass / 0 fail / 6677 assertions / 95 files；日志 `/tmp/neant-hooks-05-delivery-check.log`。最新 focused hook/lifecycle/disposal 54 pass / 196 assertions，`tsc -b` 通过。
