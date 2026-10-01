Status: resolved

# 内置 ripgrep

## 目标

Agent Core 的 grep 工具使用随依赖安装的 ripgrep 二进制。用户无需在系统 PATH 中安装 rg，就能在当前 Bun 运行方式下搜索代码。

## 已确定的决策

- Q1：本次范围是当前 Bun 源码运行及真实 CLI 进程。Bun 单文件发行和 Electron 资源打包另行处理。
- Q2：固定调用内置 rg 的绝对路径，不查找或回退到系统 PATH 中的 rg。
- Q3：内置二进制仅供 grep 工具调用，不修改 bash 的 PATH，也不保证 bash 中直接输入 rg 可以执行。
- Q4：依赖加载或二进制执行失败时，这次 grep 调用返回 isError，模型可以继续处理，其他工具和 CLI 启动不受影响。
- Q5：实际验收覆盖当前 macOS ARM64 / Bun 1.4.2；其他平台使用上游平台包解析，但本次不声称已验证。

## 实现约定

- @neant/agent 添加精确锁定的 @vscode/ripgrep@1.18.0，并更新 bun.lock 和 docs/tech-stack.md。
- 在 grep 的 execute 内通过动态 import 加载 @vscode/ripgrep，取得 rgPath 后使用现有 Bun.spawn 参数数组执行。避免顶层静态导入将平台包缺失变成整个 Agent Core 的加载失败。
- 保留 grep 的公开参数、正则搜索、忽略规则、文件名/行号输出、截断提示、60 秒超时、AbortSignal 以及 rg 退出码 1 表示无匹配的行为。
- 加载或执行故障应向模型提供明确的“内置 ripgrep 不可用”说明和原始原因。修复建议针对 Neant 的依赖安装或平台兼容性，不再提示用户安装系统 rg。错误由现有 pi loop 转为 isError，不改变 Run 的异常边界。
- 权限仍由现有 beforeToolCall 判定，grep 保持默认只读授权。
- 同步总规格中 grep 的部署及故障要求，在已完成的任务 04 Comments 中追加后续变更说明，保留原交付记录。

## 验收与执行

沿用已约定的测试边界，不引入内部模块 mock：

1. Seam 1（createSession/run）：PATH 中没有 rg 时，真实内置二进制仍能完成搜索；保留正则、忽略规则和无匹配结果的验收。
2. Seam 2（真实 CLI 进程 + 假 OpenAI 服务）：子进程 PATH 中没有 rg，grep 调用仍成功。
3. Seam 2：在隔离子进程中将 npm_config_arch 设为不存在的平台包，验证动态导入失败变成模型收到的 isError；同时调用 read 验证其他工具仍可使用，Run 能完成。
4. /implement 在上述边界上逐个执行红绿测试；定期运行 tsc -b 和相关测试文件，最后运行 bun run check、/code-review 的 Standards 与 Spec 两轴审查，再提交当前分支。

## 已核实的事实

- 本会话临时安装 @vscode/ripgrep@1.18.0 后，Bun 1.4.2 在 macOS ARM64 上可以通过命名导入取得 rgPath，再通过 Bun.spawn 执行；子进程 PATH 为空时搜索成功，退出码 0。
- 上游在模块加载时通过 createRequire().resolve() 解析对应平台包；缺少平台包会直接抛错。npm_config_arch 优先于 process.arch，是上述隔离故障测试的真实触发方式。[版本化源码](https://github.com/microsoft/vscode-ripgrep/blob/v1.18.0/packages/ripgrep/lib/index.js)
- 二进制随平台包 tarball 提供，没有 postinstall 或运行时下载；实测禁用安装脚本后仍能安装并执行，无需新增 trustedDependencies。[官方说明](https://github.com/microsoft/vscode-ripgrep/blob/v1.18.0/README.md)
- npm 包版本与 rg 自身版本不是同一概念；本会话安装的 Darwin ARM64 二进制报告 ripgrep 15.0.0。记录依赖版本，不假设所有平台的二进制版本完全一致。

## 文档边界

本次没有新增领域术语，不修改 CONTEXT.md。二进制来源是易替换的依赖选择，当前不需要新增 ADR。

2026-10-01：用户已确认这份完整说明，按 /implement 进入实现。

## 完成记录

- 2026-10-01：实现及上述两条公开测试边界的验收完成；`bun run check` 通过（格式、lint、`tsc -b`、knip、全量 62 个测试，0 失败）。
- `/code-review` 规范审查与规格审查各 0 项问题。
- 实测 macOS ARM64 / Bun 1.4.2；其他平台、Bun 单文件发行和 Electron 打包未验证。
