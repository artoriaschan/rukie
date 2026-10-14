---
status: accepted
---

# Session 附加目录只提供路径和项目指令

## 问题

跨仓库工作需要模型知道多个目录及其约定，但 Session 的工具、权限路径和文件跟踪仍需要一个明确的工作目录。合并附加目录的可执行配置会扩大信任与执行范围。

## 决定

部分替代：附加目录进入 Session 访问范围并改变文件工具的模式默认值，由 [ADR-0044](0044-session-access-scope.md) 替代本文“权限路径解析保持原有语义”的部分；指令加载与不合并可执行配置的规则继续有效。

Frontend 在每次打开 Session 时通过 `createSession` 提供 `additionalDirectories`。Agent Core 要求绝对路径，规范化后去重并排除 cwd；Session 仍只有一个 cwd，工具执行目录、权限路径解析与文件跟踪保持原有语义。

首次 Run 的环境快照列出附加目录。每个附加目录仅加载自身 `AGENTS.md` 作为 Project Instructions，按独立 reminder 来源比较当前内容并在变化时追加；提醒记录在 Transcript，Session Resume 可重建已提供的模型输入。目录选项由 Frontend 重新提供，不另存为 Session 配置。

附加目录不贡献 `.rukie/settings.json`、hooks、`.mcp.json` 或技能，也不改变 [ADR-0014](0014-permission-rules-and-project-trust.md) 的精确路径信任规则。cwd 的现有指令 fallback 与配置发现规则保持有效。原生持久化与上下文投影继续遵循 [ADR-0024](0024-adopt-pi-durable-harness.md)。

## 备选方案

从附加目录合并 hooks、MCP、settings 与技能：用户已在[规格](../../.scratch/project-directories/spec.md)中排除该方案，避免多个目录的可执行配置与同名能力产生不明确的归属。

## 影响

Frontend 负责提供当前目录集合；Agent Core 不通过历史 Transcript 推断新的目录配置。附加目录的指令变化不会重写历史输入，独立来源避免一个目录的更新重复注入其他目录的指令。附加目录不构成文件访问沙箱，工具原有的授权规则继续生效。实施与公开行为验证见[工单 01](../../.scratch/project-directories/issues/01-additional-directories.md)。
