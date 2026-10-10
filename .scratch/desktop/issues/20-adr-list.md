# 20: 桌面端 ADR 清单

Type: grilling

Blocked by: 18, 19

Status: resolved

## Question

汇总地图决策，确定要新增、修改或标记被替代的 ADR：推翻 ADR-0012 的“view 抽成 UI 包”；Effect 只在 server 内；wire 协议在 `@rukie/shared` 且单活跃连接；桌面端注册表在 Agent Core 之外；ADR-0003 的“桌面端用 SQLite”与 ADR-0024 冲突（桌面端沿用同一 JSONL store，与 TUI 互见 Session、共享单写者 lease），是否将 ADR-0003 标为被 ADR-0024 替代。每条确定标题、决策与取舍，起草放进 spec 阶段还是现在落地。

## Answer

2026-10-10 grilling 定稿。判定标准：难以逆转、缺上下文会意外、确有取舍，三者同时满足才写 ADR。ADR 正文在 `/to-spec` 阶段与 spec 架构章节、`## ADR Coverage` 表一起起草，经 PR #12 交付；本票只定清单。

新增 ADR：

- 桌面端包结构：新建 `ui`、`server`、`desktop` 三包，GUI 不复用 `coding-agent/src/view/`，跨端只共享 `@rukie/shared` 协议类型，`packages/ui` 五层单向依赖（[01](01-packages-and-effect-boundary.md#answer)、[19](19-ui-package-layering.md#answer)）。部分替代 [ADR-0012](../../../docs/adr/0012-single-coding-agent-package.md) 中“view 在引入 web 或桌面端时整体抽成 UI 包”一句；ADR-0012 保持 `accepted`，在原文标注替代范围与链接。
- server 技术栈：Hono 只做接入层，Effect 只在 server 内做应用与业务运行层，不越过 server 边界，Agent Core 与 ui 不依赖 effect；`effect` 4.0.2（[01](01-packages-and-effect-boundary.md#answer)、[04](04-research-effect-on-bun.md#answer)）。
- wire 协议与本机鉴权：单窗口单 WS 按 `sessionId` 复用、新连接接管、单活跃连接；命令以 TypeBox 定义在 `@rukie/shared`，SessionEvent 原样转发；`InteractionIdentity.epoch` 作关联 ID；token 走 WS subprotocol 并校验 Host/Origin（`app://rukie`）；运行中发送走 Queued Input（[02](02-connection-and-process-semantics.md#answer)、[06](06-research-local-server-auth.md#answer)、[10](10-wire-protocol-messages.md#answer)、[16](16-research-electron-app-scheme.md#answer)）。
- 桌面端存储：与 TUI 共用同一 JSONL store，Session 互见，共享单写者 lease；项目与置顶由 Agent Core 之外的桌面端注册表维护（[05](05-research-store-lease-concurrency.md#answer)、[10](10-wire-protocol-messages.md#answer)）。同时把 [ADR-0003](../../../docs/adr/0003-dual-session-store.md) 整份标为 `superseded`：JSONL 选型已由 ADR-0024 保留，桌面端 SQLite 由本 ADR 推翻，无剩余有效内容。

不写 ADR（只更新事实或写进 spec 与文档）：

- 只支持 macOS arm64、本地 ad-hoc 构建、不接 CI：effort 范围，记在 [03](03-mvp-scope.md#comments) 与 spec；日后扩大平台再新建 ADR。
- 孤儿 Background Job 作为已知限制（[18](18-orphan-background-jobs.md#answer)）：写进 spec，日后补回收不难逆转。
- Vitest 接入细节（[13](13-research-vitest-setup.md#answer)：`bunfig.toml` 排除 ui/desktop、`test:desktop` 只进本地 `check`、vitest 5.0.3）：更新 [ADR-0004](../../../docs/adr/0004-test-runner-per-runtime.md) 的事实。
- sidecar 单文件编译放在 `Contents/Resources/`（[11](11-research-sidecar-packaging.md#answer)）：更新 [ADR-0001](../../../docs/adr/0001-agent-runs-in-bun-sidecar.md) 的事实；签名细节（[17](17-research-packaging-details.md#answer)）写进 spec。
- 专用库与 beUI 安装（[14](14-research-specialized-libraries.md#answer)、[15](15-research-beui-install.md#answer)）：写进 tech-stack 与 DESIGN.md。
