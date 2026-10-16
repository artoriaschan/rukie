# 07：MCP 连接健康与工具同步

Status: claimed
Blocked by: 06

**What to build:** 按 [spec](../spec.md) 的「MCP Host」「状态接口」两节，让长期共享的连接保持健康：意外断开自动恢复，server 更新工具后下个 Turn 可用，中止一个 Run 不影响其他 Session 的连接。

- [x] `McpServerView.status` 新增 `pending`，表示连接中或重连中，非已连接状态工具数为 0；TUI 面板与 zh/en 文案同步
- [x] 意外关闭后指数退避重连（初始 1 秒、上限 30 秒、最多 5 次），稳定后计数清零；重连前确认旧一代连接已关闭；需要授权的 server 不重连；断线期间工具调用直接向模型返回错误
- [x] 订阅 `tools/list_changed`，每个 server 串行同步，整代替换，失败保留上一代并告警；工具名保持不变，Session 在 Turn 边界读取并沿用 loadout 漂移检测
- [x] Run 开始前等待 `pending` 的 server 落定；中止 Run 只取消等待，不关闭共享连接
- [x] 状态变化发布 `mcp_servers_changed`
- [x] Agent Core 端到端测试用虚拟时钟覆盖退避与上限、旧连接确认、`list_changed` 成功与失败、中止 Run 不关连接

## Comments

- 2026-10-16：新实施代理 `/root/implement_07` 在 `/tmp/rukie-composer-07`，基线 `d1e0ac80`；沿用已批准的公开 MCP Host / Session 测试缝，使用 tdd skill。主代理拥有 aggregate/static/browser 验证。

### 实施与验证（待评审）

- 普通 `McpHost.acquire(...).snapshot()` 和 `session.mcpServers()` 重读配置后立即返回，不等待协议初始化；连接中或退避中为 `pending`，工具数组为空且 `toolCount=0`。`snapshot({ refresh: true })`／`mcpServers({ refresh: true })` 仍在空闲时等待连接落定。项目视图的 `prepareRun({signal})` 等待初始连接、退避与重读配置后新建的连接；abort 只取消该调用方等待。`prepareTurn(signal)` 等待已接受的工具同步并更新视图工具集，供根 Session 与子代理使用。票 08 可复用这些公开 Host view 接口，在新会话页直接读取 pending；连接租约由 acquire/close 管理，普通读取不需要 Session。
- 连接意外关闭后依次等待 1/2/4/8/16 秒，最多 5 次恢复，计算延迟上限为 30 秒；连续已连接满 30 秒才清零次数。主动关闭、退休和 needs-auth 不恢复。关闭使用每个 SDK client 的首次 close Promise，替换前等待原 transport 完成清理；授权新 client 也装入同一组 close/error/notification 监听器。断线时移除新 Turn 的工具，旧引用通过当前连接查找直接失败，不等待重连。Host shutdown 后进行中的连接准备不会重新打开 owner。
- 使用锁定 pi-mcp 1.0.4 的 `onNotification("notifications/tools/list_changed", listener)`，每 server／连接代串行读取完整分页列表；完整成功才同步替换 tools、描述、schema 与状态，失败保留原代并告警。退休代晚到结果被丢弃。同名 MCP 描述与 schema 变化也触发 loadout drift；根 Session 与子代理均在 Turn 边界采用最新声明。状态变更通过既有 `mcp_servers_changed` 发布。
- TUI 服务器列表和详情呈现 pending 的中英文“连接中”／“connecting”，保留原有 reconnect/back、键盘、阅读、busy 和授权流程。无需新增组件来源；沿用既有 terminal primitives。文档按 rukie-doc 更新 `docs/mcp.md` 的恢复、快照等待与工具同步合同。
- 验证记录由主代理统一维护；以下是本票独占 evidence，不改共享 verification.md。不运行 check:dev、aggregate check 或手工浏览器；这些由主代理统一负责。本票不启动 Electron。
- 依赖安装：`rtk proxy bun install --frozen-lockfile`，退出 0，1.06s。
- 红灯：pending 公开 Host 读取被旧实现阻塞，`bun test .../mcp-health.test.ts` 0 pass / 1 fail，1002.68ms 测试超时；取消等待／pending 实现后 1 pass，8.86ms。意外断线公开 stdio 用例旧实现返回 failed 而非 pending，1 fail，64.65ms；恢复实现后两例 2 pass，300ms 文件耗时。
- 红灯：同名描述／schema 在根 Session 下一 Turn 仍为 old，root 1 fail（109.20ms）、child 原有路径 1 pass（113.49ms）；扩展 declaration drift 与根／子 Turn 边界后两例通过。TUI pending 缺失本地化键，zh/en 2 fail（480ms 文件）；补文案后 2 pass（130ms 文件）。
- 首次受影响 Agent 组合 `/tmp/rukie-07-agent.log`：125 pass / 20 fail / 1 error，624 expects，13.16s。按共同原因修复：旧测试把首次状态读取视为阻塞发现，现通过 ordinary pending→explicit settled refresh 保留全部配置、schema、不可变副本、信任、auth、busy、取消、事件去重和不重连断言。一次测试失败后的清理关闭了未 await 的 Run 导致那 1 error，随原断言更新后消失。没有放宽产品断言或跳过测试。
- 第二次 Host/API/OAuth focused `/tmp/rukie-07-incremental.log`：55 pass / 6 fail，2.22s；剩余为 pending 增加的事件精确次数、一个误用于活动 Run 的 explicit refresh 和 setup 尚未 settled。API/OAuth 再次修复后 `/tmp/rukie-07-api.log`：45 pass / 2 fail，1.99s，最后两例只剩事件次数；最小修复后 2 pass / 0 fail，19 expects，150ms。原始失败日志保留。
- 完整受影响 Agent 10 文件最终组合（只限 MCP Host、Session 与 OAuth 的影响范围，不是 aggregate check）：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/mcp-health.test.ts packages/agent/tests/e2e/mcp-host.test.ts packages/agent/tests/e2e/mcp-api.test.ts packages/agent/tests/mcp/host.test.ts packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts packages/agent/tests/e2e/mcp-goal.test.ts packages/agent/tests/e2e/subagent-mcp-oauth.test.ts`：150 pass / 0 fail，702 expects，7.59s，`/tmp/rukie-07-agent-final.log`。
- 交付审阅补获 Run 在首次连接等待期间配置变化的第二代 pending 漏等：公开 Host 用例先红 1 fail，10.07ms（prepareRun 过早完成）；修为最后配置重读后再等待新集合。只使 Host 准备证据失效，最小 Health/Host/模块组合 26 pass / 0 fail，123 expects，1.028s；新用例5.37ms，其他 Agent 证据继续有效。
- 新 Health 12 用例均小于 150ms；覆盖 parent 虚拟时间精确截止前／截止时、连续健康 30 秒清零、5 次早断耗尽、初始化与退避等待取消、same-name root/child 声明、分页串行与整代发布、失败保留、过期代忽略、首次关闭等待、needs-auth/intentional suppression、模型旧工具立即错误、配置变更等待。stdio 子进程真的退出，只将 supervisor 所在父进程的定时器设为虚拟；其余用 loopback HTTP／SSE 与完成事件，不使用固定 sleep。
- TUI 原有四个 MCP e2e 与面板组件组合 `/tmp/rukie-07-tui.log`：78 pass / 1 fail，388 expects，12.93s。唯一失败是原 loading 文案已变为 pending；更新公开屏幕断言后最小 `.../mcp-panel.test.ts -t 'closing a pending panel'` 1 pass / 0 fail，3 expects，520ms 文件／319.09ms 用例。其余 TUI 证据复用；组件 pending zh/en 2 pass / 0 fail。既有阅读锚点 >1s 用例验证真实 terminal 阅读／渲染，没有新增长等待。
- focused TypeScript 两次先暴露测试设置 `toolSearch:false` 与 terminal 主题键错误；改成锁定类型的 `"off"` 与既有 `inactive` 后 `rtk proxy bunx --no tsc -b packages/agent packages/coding-agent --pretty false` 退出 0。changed-files oxlint 与新 Health 文件 oxlint 退出0，日志 `/tmp/rukie-07-types.log`、`/tmp/rukie-07-lint.log`。最后 Host 改动后会补失效的 focused static，文档／format／diff 和 hooks 记录随后追加。
- ADR coverage：沿用 ADR-0011／0024／0047；30 秒稳定清零属于 supervisor 的可验证实现阈值，在拥有恢复合同的 docs/mcp.md 明确记录，不改连接归属决定。保持 claimed，等待新评审代理与主代理的统一验收。

- 最后源码审阅补充已过期授权连接的 close 忽略与同步完成时的当前连接检查；只使 Health/OAuth 证据失效，`rtk proxy env -u NO_COLOR bun test .../mcp-health.test.ts .../mcp-oauth-lifecycle.test.ts .../subagent-mcp-oauth.test.ts`：33 pass / 0 fail，166 expects，2.44s。随后将 needs-auth 的 onChange 放到认证工具整代替换完成处，最小 revoked-authorization／scope-step-up 三例 3 pass / 0 fail，22 expects，449ms。其他有效证据复用。
- 最终 focused tsc（agent/coding-agent）、changed-files oxlint、新 Health oxlint、changed-files oxfmt --check 和 git diff --check 全部退出0。`rtk proxy bun run docs:update` 与 `rtk proxy bun run check:docs` 通过，157 Markdown 文件。无未解决的本票 focused 失败；原始失败与复验范围如上保留。
