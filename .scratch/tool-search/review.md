# Tool Search code review fixes

2026-10-08：审查发现与修复记录；spec 和 03 验收票保持待集成分支最终检查状态。

- P1：子类型白名单不包含 ToolSearch 时，loadout 原先仍延迟允许的 MCP 工具，子对话收到空工具集且 reminder 要求调用不可用的 ToolSearch。启用现在要求当前允许的目录注册 ToolSearch；受限子类型的 MCP 工具直接提供，不扩大工具白名单或执行权限。
- TDD：通过 createSession、真实 MCP stdio fixture、原生子请求结算复现，仅允许 mcp__local__echo 的子对话工具集为 []，两项用例 RED；修复后 GREEN。分别验证正常执行 echo 与 full-access 下显式 deny 仍拒绝执行；两项均确认无 Deferred Tool reminder、仅允许 echo 可见、父会话仍使用 ToolSearch。无固定等待，新用例各约 103–104ms。
- P3：architecture.md 更正 Session 组合职责：session/tools.ts 组装内置能力工具，session/index.ts 协调 MCP、ToolSearch、完整目录和请求 loadout。docs/mcp.md 与 spec 同步受限子类型的启用前提。
- 验证：env -u NO_COLOR bun test packages/agent/tests/e2e/tool-search.test.ts packages/agent/tests/e2e/tool-search-children.test.ts：32 pass、0 fail、110 assertions，3.08s。bun run check:dev（format、lint、tsc、Knip、tracker、docs、ink boundaries）与 git diff --check 通过。未在修复分支执行 aggregate，由集成分支最终执行一次。
- ADR coverage：受限子类型例外是既有 allowlist 边界下的局部启用条件，无需新增 ADR；工具组合文档更正符合 ADR-0011，ADR-0025 的客户端检索、Transcript 发现集和 ADR-0024 的原生 harness 复用决定不变。

- P3 最终核对：session/tools.ts 不组装 MCP 工具，修正职责表述为内置能力工具；MCP 组合归 session/index.ts 协调。文档局部修正以 check:docs、oxfmt 与 diff 检查验收，不重复 aggregate。

- 集成 aggregate 发现声明消费者旧断言：tool-declarations.test.ts 的 later Run 子类型刷新仍期待整表移除／重加，而新 planner 保留未变化声明，只移除旧 subagent 后追加更新声明。最小单例 RED（110.97ms）确认；仅更新断言为 subagent 差异与存活工具原位、更新 subagent 末尾顺序，同时保留新类型精确 description 校验，未修改生产代码。
- 该局部修正验证：env -u NO_COLOR bun test packages/agent/tests/e2e/tool-declarations.test.ts packages/agent/tests/e2e/tool-search.test.ts packages/agent/tests/e2e/tool-search-children.test.ts：43 pass、0 fail、129 assertions，4.70s，修正用例 54.69ms；bun run check:dev 与 git diff --check 通过。此次 focused 结果不替代或更改集成 aggregate 的实际失败记录，最终验收由集成分支处理。
