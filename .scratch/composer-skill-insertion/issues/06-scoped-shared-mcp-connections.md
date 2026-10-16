# 06：MCP 连接按作用域共享（MCP Host 归属切换）

Status: claimed
Blocked by: 02

**What to build:** 按 [spec](../spec.md) 的「MCP Host」「MCP 配置格式」两节与 [ADR-0047](../../../docs/adr/0047-host-owned-mcp-connections.md)，把 MCP Host 改为进程级并在全局连接表中按作用域共享连接。同项目的多个 Session 共用连接，TUI 替换 Session 不重连，全局 server 只运行一份。

- [x] server、TUI、Headless 各创建一个进程级 MCP Host 并注入 Session；子代理共用父 Session 的租约
- [x] 作用域：用户级 server 默认全局单例，stdio 在配置 `cwd` 或 `homeDir` 启动；引用 `${RUKIE_PROJECT_DIR}` 的用户级 server 与项目 `.mcp.json` 的 server 按项目各一份，在项目目录或配置 `cwd` 启动
- [x] 用户级 stdio 新增可选 `cwd`；`args`、`env`、`cwd` 展开 `${RUKIE_PROJECT_DIR}`
- [x] 连接键为作用域、server 名与展开后配置的稳定签名；签名变化新建连接，旧连接在进行中的调用结束后关闭
- [x] 项目视图沿用项目覆盖同名用户级与 Trusted Project 规则；配置在用户消息前、原生 Run 前重读，并发合并
- [x] 租约：项目实例最后一个租约释放 30 秒后关闭（虚拟时钟验证截止前与截止时）；全局单例在 MCP Host 创建时后台并行预热（stdio 3、远程 8），保留到进程退出
- [x] 授权状态挂在连接上，并发授权去重，发起方取消时共享等待者收到取消；登录、登出、重连在该 server 有进行中调用时返回 busy；MCP Credential 身份与存储不变
- [x] 桌面端启动时只为全局单例解密用户级 MCP 配置与凭据，Hooks 与供应商凭证不解密
- [x] Session 的 `mcpServers()` 与管理方法返回项目视图快照；MCP reminder、Hook 调用、`authenticate` 暴露规则不变
- [x] 按新归属改写受影响的 Agent Core 与 TUI MCP 测试，不削弱断言；新增多 Session 共享、作用域与启动目录、签名替换、租约宽限、TUI 替换 Session 不重连、授权去重测试
- [x] 更新 docs/mcp.md 的配置、连接归属与 Frontend 接口章节，写明用户级 stdio 不再隐式使用项目目录

## Comments

- 2026-10-16：新实施代理 `/root/implement_06` 在 `/tmp/rukie-composer-ticket-06`、`feat/composer-ticket-06` 认领；基线 `6970a5b9`。测试缝沿用规格已确认的公开 Session / MCP Host 与真实 loopback MCP 边界，使用 TDD。主代理拥有统一静态、全套和浏览器验证。

### 实施与验证（待评审）

- Host 全局连接表使用作用域、server 名和展开配置的稳定签名，项目视图持有租约、调用方 Interaction 和独立副本状态。连接持有授权去重与进行中调用；配置替换等旧调用结束再关闭。移除独立探测 manager，原有模块用例迁移到公开 Host 视图，所有受影响消费者已更新。
- 用户全局 stdio 默认 homeDir，可设置 cwd；项目 `.mcp.json` 和引用保留项目变量的用户配置分别实例化，args/env/cwd 展开，项目覆盖和 Trusted Project 规则保留。全局后台预热并发上限 stdio 3、HTTP 8；项目最后租约释放 30 秒后关闭，重新租用取消期限。server 统一注入 Host，createChat 跨 Session 替换持有 Host，Headless 在退出与初始化失败时清理自己创建的 Host。子代理使用父视图，无独立租约。
- 授权在共享连接上去重，动态绑定发起 Session 的回调和 origin，发起方取消共享返回 cancelled。管理操作保留 Session busy/typed error 契约，并检查该 server 的活动调用；无授权回调的 Headless 不暴露 authenticate 工具或其 reminder。
- 桌面启动经专用 applicationMcpPersistence 只读取用户 MCP 配置及全局 HTTP 身份凭据，Hooks 和 Provider 凭据保持延迟。新增身份级断言，替换与 ADR-0047 冲突的“启动总计 0 次解密”断言。没有启动 Electron 或调用真实钥匙串。
- 既有断言的合同调整：状态查询和重连后的健康 transport 保留到 Host 退出；同名项目覆盖不阻止独立用户全局预热；普通状态查询重读配置；logout 保留 needs-auth 记忆而不重复未授权请求。保留工具、权限、错误、原始 schema、不可变副本、无 Transcript 写入、busy、取消、信任与事件去重断言。旧 manager 用例经 Host seam 保留。
- 基线 `6970a5b9`。依赖 `rtk proxy bun install --frozen-lockfile` 退出 0，1.09s。
- 红灯：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/mcp-host.test.ts -t 'survives Session'`，0 pass / 1 fail，248ms，初始化 expected 1 / received 2。共享表完成后两例 Host 用例 2 pass / 0 fail，270ms。
- 首次既有 Agent 兼容验证日志 `/tmp/rukie-06-first-existing.log`：123 cases，75 pass / 48 fail / 3 errors，51.09s。失败聚类为初始化事件未转发、版本来源遗漏、等待与 Host 关闭死锁、管理/快照去重和旧独立探测断言。按所属原因批量修复后 `mcp-config` + `mcp` + 初始 Host 48 pass / 0 fail，216 expects，2.76s；日志 `/tmp/rukie-06-regressions.log`。
- 新宽限测试红灯：重新租用清除计时器但未清除保存的 handle，第二次释放不注册期限，1 fail（5.30s 文件结果）。修复后单例 1 pass，4 expects，121ms，准确验证 29999/30000ms 与重新租用。新 scope/cwd 测试首次因 macOS `/var`/`/private/var` 真实路径差异失败，改为通过 `realpath` 取得预期物理路径；没有正规化产品结果。新 active-call 测试首次 fixture API 名错误，修正为 locked pi-ai 的 fauxToolCall。
- Agent focused 最终组合：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/mcp-host.test.ts packages/agent/tests/e2e/mcp-api.test.ts packages/agent/tests/mcp/manager.test.ts packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts packages/agent/tests/e2e/mcp-goal.test.ts packages/agent/tests/e2e/subagent-mcp-oauth.test.ts`，135 pass / 1 fail，625 expects，7.09s，日志 `/tmp/rukie-06-agent-final.log`。唯一剩余失败是关闭尚在管理准备阶段的 login 返回 closed 而非 cancelled；修复取消映射后最小 Host/API/模块组合 45 pass / 0 fail，197 expects，995ms，日志 `/tmp/rukie-06-agent-incremental.log`。模块测试随后仅更名为 `tests/mcp/host.test.ts`。
- 新 stable-signature 用例 1 pass，4 expects，145ms；HTTP 预热上限用例 1 pass，3 expects，124ms。最终连接键改为 JSON tuple、防止路径/名称分隔碰撞，并识别带 default 的保留变量；只补受影响 scope/cwd/signature 三例，3 pass / 0 fail，14 expects，285ms。其他上述 Agent 证据有效；主代理协调 aggregate 共享生命周期验证。
- TUI 原有四个 MCP e2e 文件：48 pass / 0 fail，224 expects，10.04s，日志 `/tmp/rukie-06-tui.log`。新增 /clear 场景首次误用 controlledModel.finish 的数字参数，修正为 reply；单例 1 pass / 0 fail，618ms。随后 logout /管理增量验证 `rtk proxy env -u NO_COLOR bun test packages/coding-agent/tests/tui/e2e/mcp-command.test.ts`：9 pass / 0 fail，27 expects，1.64s，日志 `/tmp/rukie-06-tui-command.log`；新增用例 321.55ms。其余 TUI 证据复用；两例既有 >1s 用例验证真实 terminal reader/Hook/持久化与阅读锚点合同，未新增真实等待。
- Headless 真实凭据复用单例 1 pass，5 expects，228ms。text/stream-json OAuth 隐藏工具用例首次 stream-json 失败，定位共享连接 reminder 泄露 authenticate 名称；按视图过滤后两例 2 pass / 0 fail，9 expects，231ms，日志 `/tmp/rukie-06-headless-auth3.log`。
- server focused 文件：`rtk proxy env -u NO_COLOR bun test packages/server/tests/server.test.ts`，87 pass / 0 fail，701 expects，7.59s，日志 `/tmp/rukie-06-server.log`。覆盖已有生命周期与新身份级启动边界。新增启动测试首次 ownedResources factory 非 Promise，修为 async factory 后通过；未修改资源所有权 helper。
- 静态：focused `rtk proxy bunx --no tsc -b packages/agent packages/coding-agent packages/server --pretty false` 通过，日志 `/tmp/rukie-06-types-final.log`；focused oxlint 首次仅三例 no-useless-spread，修正后通过，日志 `/tmp/rukie-06-lint-final.log`。改动文件 oxfmt 与 git diff --check 通过。文档 `rtk proxy bun run docs:update`、`rtk proxy bun run check:docs` 通过（157 Markdown）。未运行 check:dev、aggregate check 或手工浏览器；主代理统一负责。
- ADR coverage：沿用 ADR-0011 / ADR-0024 / ADR-0047 与规格已接受决定，没有新增长期架构决定。票 07 接续低层 connection owner 的 onChange/event 通知实现 supervisor、tools/list_changed 和 pending；票 08 接续不依赖 Session 的状态 wire。保持 claimed，待新评审代理和主代理统一验证。

- 交付前代码审阅补充独立 resource 集合，保证 A→B→A 配置变化时旧同签名代退休完成不会从索引删掉新代，Host close 也能覆盖仍在退休的代。只补 retirement/close/signature 三例，3 pass / 0 fail，14 expects，254ms；文档和 diff 检查继续通过。

- 严格配置审阅新增 cwd 空字符串/数字公开回归，先红灯 0 pass / 2 fail，222ms（错误地启动 executable），再保留无效原值交给 schema 校验；补同两例验证 2 pass / 0 fail，2 expects，211ms；focused lint/format 通过。

- 提交 hooks 的 lint-staged 格式与 lint 通过；首次 commitlint 因 body 单行超过 100 字符拒绝，改短正文后正常重提，没有跳过 hooks。提交前已将最新集成 `62124c8a` 快进到本票分支，新增差异仅是其他票 UI 与验证记录；本票 MCP 源码未被改写，复用上述行为证据。

- 最新集成 `54b2c693` 的合并仅在 server 测试尾部追加处冲突；按 resolving-merge-conflicts 流程保留 MCP startup 与 skills.list 两个完整用例，server 生产接线自动合并。增量 `rtk proxy env -u NO_COLOR bun test packages/server/tests/server.test.ts -t 'startup warms only|MCP Host startup|skills.list works'`：3 pass / 0 fail，29 expects，342ms，日志 `/tmp/rukie-06-merge-server.log`；affected agent/server tsc 通过，日志 `/tmp/rukie-06-merge-types.log`。复用其他有效证据，未扩大为 aggregate。
