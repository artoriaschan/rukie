# 05：provider/auth 分发完整性

Status: resolved
Blocked by: 03

## What to build

用户安装任一 macOS 平台包后，仍能使用现有模型适配器与认证能力。维护者可以发现打包遗漏的动态模块，而不会将单个 fake provider 的成功误判为全部能力可用。

## Acceptance criteria

- [x] 对照锁定 pi 和 Rukie 当前支持范围列出需要验证的 provider/auth 路径，不为简化打包删除现有支持。
- [x] 处理 OAuth/provider 动态加载及其运行资源，使用可追踪入口或明确资源分发，继续复用锁定适配器。
- [x] 通过安装后的公开命令与正常设置证明相关路径可加载，不依赖源码仓库、开发依赖或外部 Bun。
- [x] 对协议不同的代表性路径使用本地服务模拟，验证可观察请求、响应、失败与取消行为；用例按真实差异选择。
- [x] 覆盖 arm64 产物，动态模块遗漏或资源定位错误产生有诊断性的验收失败。
- [x] 保持 02/03 的基础 Session、工具和版本验收通过，并准确保留当前 auth 的用户凭据归属。
- [x] 文档区分打包加载、本地协议模拟和真实远程认证/模型连通性；后者未执行时明确标为未验证。
- [x] 不读取真实凭据、不发付费模型请求，不向产品新增测试专用加载接口。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 20、34–35、58。03 提供 arm64 安装基线；与 TUI 工单 04 无相互阻塞。

## Comments

- 2026-10-09：首版只支持 macOS arm64，双架构要求改为 arm64，见父规格 Out of Scope。
- 2026-10-07：拆分已确认。模块加载成功不等于真实 OAuth 或模型服务已验证。

- 2026-10-09：基于 621ba48c 集成基线开发；预先确认的安装命令 seam，新增 Responses / Anthropic / 内置 Azure 实际 Session，Bedrock loopback 签名和错误、Responses SIGINT 取消。旧产物 focused 7/7 通过；模块图清单测试先因缺少 release-modules.json 失败，等待 04 构建审计输出与共享 PTY 后完成认证验收。

- 2026-10-09：完成 05；基于集成分支 57c2a4e9 的 04 PTY 与构建模块审计，安装包不新增运行业务路径。代表性验证：custom Responses / Anthropic 与内置 Azure 实际 Session；内置 Bedrock loopback 签名和 SDK validation failure；Responses SIGINT 取消；缺少凭据仅记录预检；模块审计覆盖全部 10 个 API family / 9 条模型 OAuth flow。
- 2026-10-09：公开 MCP OAuth 使用安装后的 `/mcp login srv`、跨进程 `/mcp reconnect srv`、`/mcp logout srv` 和取消；复用真实 HTTP/PKCE fixture，隔离 PATH 的 `open` 替身仅允许 loopback 授权和 callback。检查注册、token endpoint 的 verifier、令牌复用，以及每次完整 termios 恢复。MCP 用例约 3.05 秒，必要成本是四次真实 PTY/进程启动与 OAuth transport；共享一次 tarball 安装，不为各场景重复构建。
- 2026-10-09：文档 `docs/release-providers.md` 列出当前 42 个注册 provider 与完整协议边界；Rukie 没有模型登录公开入口、默认模型 CredentialStore 位于内存，九条上游 OAuth flow 的嵌入不得声称远程认证成功。所有最终 runtime fixture 使用本地 endpoint 与伪造凭据；正式 npm、真实远程 OAuth/模型和真实 CI 未执行。
- 2026-10-09：ADR Coverage 审阅沿用父规格的 ADR-0023 CLI 分发与 ADR-0024 上游 harness 能力，未改变用户凭据归属、MCP OAuth、Session/Run 语义或 Yoga 范围例外；构建清单是审计证据，不替代校验过的 tarball 身份。
- 2026-10-09：最终 focused `RUKIE_RELEASE_ARTIFACTS=/tmp/rukie-release-04 bun test scripts/release/tests/providers.test.ts` 为 9/9、63 assertions、6.59 秒（含一次 npm 安装），MCP 四进程用例 2.43 秒；首次 Responses 1.05 秒为真实子进程冷启动及 SDK/HTTP 初始化，后续协议用例 0.21–0.29 秒。已复用 04 校验通过的严格身份产物，05 没有重新构建。`tsc -b`、`oxlint`、`knip`、`check:docs`、`check:scratch`、修改文件格式和 diff 检查通过；最终全量 check 由集成分支统一执行，未在 05 重复。
