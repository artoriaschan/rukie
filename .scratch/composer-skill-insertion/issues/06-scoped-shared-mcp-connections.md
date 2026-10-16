# 06：MCP 连接按作用域共享（MCP Host 归属切换）

Status: ready-for-agent
Blocked by: 02

**What to build:** 按 [spec](../spec.md) 的「MCP Host」「MCP 配置格式」两节与 [ADR-0047](../../../docs/adr/0047-host-owned-mcp-connections.md)，把 MCP Host 改为进程级并在全局连接表中按作用域共享连接。同项目的多个 Session 共用连接，TUI 替换 Session 不重连，全局 server 只运行一份。

- [ ] server、TUI、Headless 各创建一个进程级 MCP Host 并注入 Session；子代理共用父 Session 的租约
- [ ] 作用域：用户级 server 默认全局单例，stdio 在配置 `cwd` 或 `homeDir` 启动；引用 `${RUKIE_PROJECT_DIR}` 的用户级 server 与项目 `.mcp.json` 的 server 按项目各一份，在项目目录或配置 `cwd` 启动
- [ ] 用户级 stdio 新增可选 `cwd`；`args`、`env`、`cwd` 展开 `${RUKIE_PROJECT_DIR}`
- [ ] 连接键为作用域、server 名与展开后配置的稳定签名；签名变化新建连接，旧连接在进行中的调用结束后关闭
- [ ] 项目视图沿用项目覆盖同名用户级与 Trusted Project 规则；配置在用户消息前、原生 Run 前重读，并发合并
- [ ] 租约：项目实例最后一个租约释放 30 秒后关闭（虚拟时钟验证截止前与截止时）；全局单例在 MCP Host 创建时后台并行预热（stdio 3、远程 8），保留到进程退出
- [ ] 授权状态挂在连接上，并发授权去重，发起方取消时共享等待者收到取消；登录、登出、重连在该 server 有进行中调用时返回 busy；MCP Credential 身份与存储不变
- [ ] 桌面端启动时只为全局单例解密用户级 MCP 配置与凭据，Hooks 与供应商凭证不解密
- [ ] Session 的 `mcpServers()` 与管理方法返回项目视图快照；MCP reminder、Hook 调用、`authenticate` 暴露规则不变
- [ ] 按新归属改写受影响的 Agent Core 与 TUI MCP 测试，不削弱断言；新增多 Session 共享、作用域与启动目录、签名替换、租约宽限、TUI 替换 Session 不重连、授权去重测试
- [ ] 更新 docs/mcp.md 的配置、连接归属与 Frontend 接口章节，写明用户级 stdio 不再隐式使用项目目录

## Comments
