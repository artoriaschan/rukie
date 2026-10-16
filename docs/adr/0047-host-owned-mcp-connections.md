---
status: accepted
---

# MCP 连接归进程级 MCP Host，Session 只租用

## 问题

MCP 连接、工具发现、状态快照与授权状态现在属于每个 Session（[MCP 配置与授权](../mcp.md)）。新会话页在 Session 创建前拿不到 MCP 状态；同一项目的多个 Session 各自启动同一批 server；TUI 替换 Session 时重新连接。连接意外关闭后要等显式重连，server 变更工具列表也不会同步。全局配置的 server 与项目无关，却随每个项目各起一份。

## 决定

每个进程有一个 MCP Host，在一张全局连接表中持有全部 MCP Server 连接。server 进程把它注入所有 Session；TUI 与 Headless 在进程级创建。Session 未获注入时创建私有 MCP Host，随 Session 关闭。

连接作用域按配置来源决定：用户级 server 默认是全局单例，stdio 在配置的 `cwd` 或 `homeDir` 启动；用户级配置在 `args`、`env` 或 `cwd` 中引用 `${RUKIE_PROJECT_DIR}` 时按项目各一份，在配置的 `cwd`（相对项目根）或项目根启动；项目 `.mcp.json` 中的 server 按项目各一份，在配置的 `cwd` 或项目根启动。连接键由作用域、server 名和展开后配置的稳定签名组成，签名变化即新建连接。

项目视图为某个项目（或无项目）解析生效的 server 集合，沿用项目级覆盖同名用户级、项目配置要求 Trusted Project 的规则，并引用全局表中的连接。Session 通过项目视图租用连接，子代理共用父 Session 的租约。项目实例在最后一个租约释放 30 秒后关闭；全局单例保留到进程退出，配置变化时按签名替换；被替换的连接在进行中的调用结束后关闭。

全局单例在 MCP Host 创建时后台并行连接，项目实例在首次租用时连接，连接过程不发起 OAuth。配置在用户消息提交前、原生 Run 开始前和 Frontend 查询状态时重读，并发重读合并。Run 开始前等待连接中的 server 落定，中止 Run 只取消等待。意外关闭的连接按指数退避重连（初始 1 秒、上限 30 秒、最多 5 次），重连前等待旧一代的原始关闭 Promise；连续健康连接满 30 秒才重置重试次数，初始化成功或短暂恢复不重置，需要授权的 server 不重连。MCP Host 订阅 `tools/list_changed`，按 server 串行同步并整代替换，失败保留上一代；工具名保持 `mcp__<server>__<tool>`，根 Session 与子代理在 Turn 边界读取，包括同名工具的描述与输入 Schema 变化。

授权状态挂在连接上，同一连接的并发授权共享流程。Interaction 由发起授权的 Session 提供，取消规则沿用 [ADR-0015](0015-frontend-interactions-and-plan-mode.md)。登录、登出、重连在该 server 有进行中的调用时返回 busy。[ADR-0019](0019-mcp-oauth-credential-ownership.md) 的 OAuth 生命周期、凭据身份与项目信任规则继续有效。

本决定部分替代 [ADR-0035](0035-desktop-isolated-sqlite-storage.md) 中「启动不解密 MCP 凭证」的规则：桌面端启动时为全局单例解密用户级 MCP 配置及其 HTTP 凭据；项目实例的凭据在首次连接时解密；Hooks 与供应商凭证仍不在启动时解密。MCP 状态快照的 `status` 增加 `pending`，Frontend 通过不依赖 Session 的状态查询读取项目视图。无项目时，引用项目目录的用户级 server 保留为 `project-required`，表示选择项目后启动。查询与只读订阅仅观察配置及现有连接，不取得租约、不启动进程；显示已有 Session、选择项目或进入 MCP 详情取得活动视图租约，切换范围或断开连接释放原视图。未选项目的新会话普通摘要只观察；离开详情后恢复当前范围的订阅。

依据：[主输入框插入技能与 MCP Host](../../.scratch/composer-skill-insertion/spec.md)。

## 备选方案

- 保持 Session 持有连接，新会话页做一次临时探测：状态是探测快照而非实时连接，多 Session 仍重复启动进程，切换 Session 仍重连。
- 所有 stdio server 按项目 cwd 各一份：保留现有隐式 cwd，但全局 server 与项目无关时浪费进程，且无项目时没有状态。
- 用户级 stdio server 继承进程 cwd：TUI 与桌面 sidecar 的进程 cwd 不同，同一配置在不同 Frontend 表现不同。
- 按来源前缀区分同名 server 并让它们并存（程小帮的做法）：需要改变工具命名，影响 Permission Rule、loadout 与 Transcript。
- 同一远程端点按凭据仲裁只保留一个：只有不同名字指向同一 URL 时才有意义，增加复杂度，收益是去掉一组带不同前缀的工具。
- 默认按 Session 隔离、server 自选共享（ZCode 的做法）：避免有状态 server 互相干扰，但失去共享的主要收益；保留以后增加隔离字段的空间。

## 影响

同项目的 Session 共用连接，TUI 替换 Session 不重连，新会话页与会话内读取同一实时状态。有状态 stdio server（如浏览器自动化）被多个 Session 同时使用。用户级 stdio server 不再隐式拿到项目 cwd，依赖当前目录的配置需要改为 `${RUKIE_PROJECT_DIR}`。连接在 Session 关闭后最多多保留 30 秒，全局单例保持到进程退出。现有 MCP 生命周期测试需要按新归属改写。实施状态见[对应规格](../../.scratch/composer-skill-insertion/spec.md)。
