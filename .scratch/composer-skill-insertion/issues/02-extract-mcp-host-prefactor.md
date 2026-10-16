# 02：抽出 MCP Host（预重构）

Status: claimed
Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md) 的「MCP Host」一节与 [ADR-0047](../../../docs/adr/0047-host-owned-mcp-connections.md)，把 Session 内部的 MCP 连接、工具列表、状态快照与授权状态抽到 MCP Host 能力中。这一步每个 Session 仍持有一个私有 MCP Host，行为与现在完全一致；目的是建立后续归属切换所需的接缝。

- [x] MCP Host 拥有配置解析、连接、工具、快照、授权状态与管理操作；Session 只通过它的接口取得工具集、reminder、Hook 调用和快照
- [x] `createSession` 接受可选的 MCP Host 注入；未注入时创建私有 MCP Host 并随 Session 关闭
- [x] Run 的取消信号与连接生命周期解耦的接口准备好，但本票保持现有关闭语义
- [x] 现有 Agent Core MCP 测试与 TUI MCP 面板测试不改断言全部通过
- [ ] 模块依赖方向符合 ADR-0011 的约束，受影响的类型检查、lint、knip 通过

## Comments

- 2026-10-16：新实施代理在 `/tmp/rukie-composer-02`、`refactor/composer-ticket-02` 认领；基线 `0d717fd9`，确认集成分支是当前 HEAD 祖先。

### 实施与验证（待评审）

- `mcp/host.ts` 提供公开 `createMcpHost`、`McpHost`；Host 持有视图，视图持有连接、授权状态、快照缓存与管理操作。Session 仅租用视图消费工具、reminder、Hook 调用和管理接口；默认私有 Host 随 Session 关闭，注入的 Host 可继续服务其他 Session。本票各视图仍隔离，未提前切换共享连接语义。
- `prepareRun` 接收本次 Run 的 signal 和子代理来源查询，Host 关闭独立于该 signal；保留现有 Run 取消、探测后关闭、SessionEnd Hook 后关闭运行连接的时序。Host 关闭后拒绝重新开启连接。
- 公共 seam：`createSession({ mcpHost })` + fake HTTP MCP 边界；没有更改任何既有 MCP / TUI 断言。新增两例验证注入 Host 跨 Session 关闭存活，以及 Host 主动关闭释放连接并拒绝后续 Run。
- 基线 `0d717fd9`；被测差异为 `packages/agent/src/{index.ts,mcp/index.ts,mcp/host.ts,session/index.ts}` 与新增 `tests/e2e/mcp-host.test.ts`。`bun install --frozen-lockfile` 安装隔离 worktree 依赖，退出 0，1.05s。首次测试准备在文件写入前误跑，未收集文件，退出 1；随后修正准备步骤。
- 红灯 1：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/mcp-host.test.ts`，退出 1，0 pass / 1 fail / 1 import error，155ms：公开 `createMcpHost` 尚未导出。最小实现后同范围 1 pass / 0 fail，235ms。
- 红灯 2：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/mcp-host.test.ts -t 'closing an injected'`，退出 1，0 pass / 1 fail / 1 filtered，197ms：Host 关闭后 `session.run` 错误地重新连接并成功。加入 view 关闭校验后纳入下列绿色验证。
- Agent MCP 验证：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/mcp-host.test.ts packages/agent/tests/e2e/mcp-api.test.ts packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts packages/agent/tests/e2e/mcp-goal.test.ts packages/agent/tests/e2e/subagent-mcp-oauth.test.ts`；退出 0，125 pass / 0 fail，579 expects，6.77s。新增两例耗时 66.13ms / 34.46ms，覆盖注入生命周期；原有取消、OAuth、Hook、子代理、Goal、配置和状态断言全部保留通过。
- TUI 消费者验证：`rtk proxy env -u NO_COLOR bun test packages/coding-agent/tests/tui/e2e/mcp-panel.test.ts packages/coding-agent/tests/tui/e2e/mcp-command.test.ts packages/coding-agent/tests/tui/e2e/mcp-auth.test.ts packages/coding-agent/tests/tui/e2e/mcp-panel-acceptance.test.ts packages/coding-agent/tests/tui/components/mcp-panel/mcp-panel.test.tsx`；退出 0，76 pass / 0 fail，384 expects，10.92s。未修改既有测试；原有真实 TUI 集成用例 1.16s / 1.48s 保留其终端、Hook 与持久化集成合同。
- `rtk proxy bunx --no oxfmt packages/agent/src/mcp/host.ts packages/agent/src/mcp/index.ts packages/agent/src/index.ts packages/agent/src/session/index.ts packages/agent/tests/e2e/mcp-host.test.ts` 通过；`rtk proxy git diff --check` 通过。格式化未改变行为，复用上述测试证据。
- 主代理协调后续静态、Knip 与最终共享生命周期全套验证；本代理未运行 `check:dev` 或 aggregate `check`，没有启动 Electron。现阶段保持 `claimed`，等待新评审代理和协调验证；沿用 spec 的 ADR-0011 / ADR-0024 / ADR-0047 覆盖，无新增长期决定。
