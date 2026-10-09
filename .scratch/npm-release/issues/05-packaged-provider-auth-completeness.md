# 05：provider/auth 分发完整性

Status: claimed
Blocked by: 03

## What to build

用户安装任一 macOS 平台包后，仍能使用现有模型适配器与认证能力。维护者可以发现打包遗漏的动态模块，而不会将单个 fake provider 的成功误判为全部能力可用。

## Acceptance criteria

- [ ] 对照锁定 pi 和 Rukie 当前支持范围列出需要验证的 provider/auth 路径，不为简化打包删除现有支持。
- [ ] 处理 OAuth/provider 动态加载及其运行资源，使用可追踪入口或明确资源分发，继续复用锁定适配器。
- [ ] 通过安装后的公开命令与正常设置证明相关路径可加载，不依赖源码仓库、开发依赖或外部 Bun。
- [ ] 对协议不同的代表性路径使用本地服务模拟，验证可观察请求、响应、失败与取消行为；用例按真实差异选择。
- [ ] 覆盖 arm64 产物，动态模块遗漏或资源定位错误产生有诊断性的验收失败。
- [ ] 保持 02/03 的基础 Session、工具和版本验收通过，并准确保留当前 auth 的用户凭据归属。
- [ ] 文档区分打包加载、本地协议模拟和真实远程认证/模型连通性；后者未执行时明确标为未验证。
- [ ] 不读取真实凭据、不发付费模型请求，不向产品新增测试专用加载接口。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 20、34–35、58。03 提供 arm64 安装基线；与 TUI 工单 04 无相互阻塞。

## Comments

- 2026-10-09：首版只支持 macOS arm64，双架构要求改为 arm64，见父规格 Out of Scope。
- 2026-10-07：拆分已确认。模块加载成功不等于真实 OAuth 或模型服务已验证。

- 2026-10-09：基于 621ba48c 集成基线开发；预先确认的安装命令 seam，新增 Responses / Anthropic / 内置 Azure 实际 Session，Bedrock loopback 签名和错误、Responses SIGINT 取消。旧产物 focused 7/7 通过；模块图清单测试先因缺少 release-modules.json 失败，等待 04 构建审计输出与共享 PTY 后完成认证验收。
