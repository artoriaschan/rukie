# 02: Core MCP 状态变更通知

**What to build:** Core 提交 MCP 展示快照后发出轻量 `mcp_servers_changed`，使可见面板读取当前记录并实时更新。详见 [spec](../spec.md) 的状态通知。

Blocked by: 01

Status: resolved

- [x] 共享 SessionEvent 增加无完整 schema payload 的 `mcp_servers_changed`；统一快照提交路径，先更新可读记录再通知，无变化不重复通知。
- [x] 首次 probe、Run 连接、同一 Run 授权成功/再次 needs-auth、管理成功/失败/取消的实际变化均可见；自动状态刷新不增加网络请求或轮询。
- [x] 缓存读取不通知；首次读取引发 probe 的提交可通知。文件级诊断变化同样发布新快照，不混入伪服务器行。
- [x] 用户显式 `mcpServers({ refresh: true })` 在空闲时重新读取配置并探测，Run 中 busy；共享在途刷新与同一资源/取消路径，不自动授权。回归覆盖损坏文件修正后重试成功，普通事件刷新不额外连接。
- [x] 保留旧 probe revision guard、管理锁、取消与 dispose 清理；事件后的公开读取不会看到旧状态，晚到 probe 不覆盖 Run 结果。
- [x] 单服务器结果只更新对应记录；首次读取前直接管理也不会把全量快照缩为单服务器，公开回归覆盖多服务器首次管理/读取竞态。
- [x] 保留已有 MCP error/auth_required 事件与既有 Headless 文本/stream-json 语义，更新必要的类型消费者；本票不改 TUI 页面。
- [x] 公共 Session 订阅测试验证事件/读取顺序、实际变化、同一 Run scopes/授权替换、无事件读取循环与无重复连接，包含微任务边界和 dispose。
- [x] 更新票状态与 focused/静态验证证据；与 03 独立基于已集成的 01 开发。

## Context pointers

- [Session](../../../packages/agent/src/session/index.ts)、[MCP](../../../packages/agent/src/mcp/index.ts)、[events](../../../packages/shared/src/events/index.ts)。
- [API tests](../../../packages/agent/tests/e2e/mcp-api.test.ts)、[OAuth lifecycle tests](../../../packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts)、[Headless tests](../../../apps/neant-cli/tests/main.test.ts)。

## Comments

2026-10-06：设计已确认，尚未实施。Frontend 订阅、页面刷新与清理由 04 接线。

2026-10-06：02 在独立 worktree `mcp-panel-02/Neant`、分支 `codex/mcp-panel-02` 认领，基线 `e6299bb914298b742ed38ef16def35c6a68083db`。公开测试 seam 按 spec Testing Decisions 使用 createSession、subscribe、fake model 与 MCP fixtures。

2026-10-06：02 已实施。统一 `commitMcpSnapshot` 先提交完整可读快照，再发布仅含 type/sessionId 的 `mcp_servers_changed`；真实内容无变化不通知，但更新 revision 以拒绝旧 probe。首次 probe、Run 连接/同一 Run OAuth 与 scope 失效、管理及配置诊断均通过此路径；缓存读取不探测、不通知。`mcpServers({ refresh: true })` 仅空闲可用，复用在途 probe 与取消/清理，管理锁覆盖刷新。首次管理对其他服务器完成独立 probe 后合并选中结果，避免部分快照；dispose 不把已完成的 cancelled 登录结果替换成清理 abort。保留旧 error/auth_required 与 Headless 输出语义，CLI stream-json 回归只补充新轻量事件的精确顺序和 payload；未修改 TUI 页面。

验证证据（本票分支，临时 HOME / unset NO_COLOR）：

- 公开红绿回归先复现无变更事件、损坏配置不能刷新、首次管理无完整通知、管理诊断不更新，以及首次管理清理中 dispose 替换 cancelled 结果；对应最小实现后通过。`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/mcp-api.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts` 最终 47 pass、0 fail、204 assertions，含微任务、同一 Run 四次授权状态转换、共享刷新、busy、读取/管理竞态、旧 probe 与 dispose。
- Core/OAuth/Subagent/Headless focused 集合：112 pass、0 fail、478 assertions，日志 `/tmp/neant-mcp-panel-02-focused.log`。配置与既有 TUI MCP 消费者（unset NO_COLOR）76 pass、0 fail、292 assertions；CLI 精确 stream-json 回归 1 pass、0 fail、23 assertions。当前全仓 format、lint、tsc -b、Knip 均 exit 0；`rtk git diff --check` 通过。
- `rtk proxy` 调用的隔离 HOME Python wrapper 在移除 NO_COLOR 后运行 `caffeinate -is bun run check`：2329 pass、0 fail、11923 assertions、166 files、335.85s，format/lint/types/Knip 全部通过，日志 `/tmp/neant-mcp-panel-02-check.log`。
- 失败记录保留：首次静态检查发现新测试的一处 optional-array expectation 类型错误并修正；初次完整测试 2327 pass、2 fail，分别为既有 Subagent/Todo layout 5000ms timeout（精确 focused 重跑 456.49ms 通过）以及应更新的 CLI 新事件顺序断言（修正后精确 focused 通过）。初次完整日志 `/tmp/neant-mcp-panel-02-check-initial.log`。一次额外消费者测试继承 NO_COLOR 导致颜色断言失败；unset NO_COLOR 后该集合全通过。最终重复完整检查中原两个失败均通过，未修改无关 UI 测试或行为。
- 真实 OAuth 账号验收仍属原 OAuth 工单 08，本票本地 fixture 证据不替代它。与最新 `codex/mcp-panel` 合并并完成 final diff/static/focused 验证后交给集成人处理；本实施 worktree 不合并 main、不推送、不删除。
