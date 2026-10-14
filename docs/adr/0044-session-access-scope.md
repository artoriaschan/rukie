---
status: accepted
---

# 文件工具按 Session 访问范围决定模式默认值

## 问题

Permission Mode 的默认值只看工具名：`read`、`glob`、`grep` 在任何路径放行，`write`、`edit` 在任何路径询问，cwd 不构成边界。[ADR-0039](0039-session-additional-directories.md) 的附加目录因此只能提供路径与指令，无法表达“附加目录扩大可读写范围”；对话也可以不经询问读取任意本机文件。

## 决定

Agent Core 为每个 Session 计算 Session 访问范围：

- cwd 与附加目录：可读写。
- 已发现技能的根目录与本 Session 的 Background Job 输出文件：只读。

路径按 `resolvePermissionPath` 的真实路径判断是否位于范围内的某个目录或其子路径；`glob`、`grep` 不给 `path` 时以 cwd 为目标。

范围只改变 [ADR-0014](0014-permission-rules-and-project-trust.md) 固定阶段中的 Permission Mode 默认值，hooks 与 Permission Rule 的先后和 `deny > ask > allow` 不变：

| 目标                                | `ask` | `auto-review`     | `full-access` |
| ----------------------------------- | ----- | ----------------- | ------------- |
| 范围内 `read`/`glob`/`grep`         | 放行  | 放行              | 放行          |
| 可读写范围内 `write`/`edit`         | 放行  | 放行              | 放行          |
| 范围外，或只读范围内 `write`/`edit` | 询问  | Permission Review | 放行          |

询问时“本 session 允许”沿用目录级临时授权（`<tool>(<dir>/**)`），父子 Session 共享，Resume 后失效。`bash`、MCP 与 `web_fetch` 不按路径判定，默认值不变；规则匹配仍以 cwd 解析相对模式。Headless CLI 没有 Interaction 回调，范围外的文件工具按安全默认拒绝，用户可用 `--allow-tools` 或 `--permission-mode full-access` 授权。TUI、Headless CLI 与桌面端共用这一条执行路径。

本决定部分替代 ADR-0039 中“附加目录不改变权限路径解析”的表述：附加目录进入可读写范围，但仍不贡献 settings、hooks、MCP 与技能，也不改变工具执行目录与文件跟踪。

## 备选方案

- 只放开范围内的写入，读取保持全局放行：用户要求同时收紧读取。
- 只对桌面端启用、Core 提供开关：产生两条执行路径。
- 不把技能根与 Job 输出纳入范围：技能引用文件与截断输出的完整内容都会被询问，阻断正常工作流。

## 影响

范围是应用授权边界，不是操作系统 sandbox：`bash` 与 MCP 可以访问范围外文件，范围内的符号链接以真实路径判定。读取本机其他位置（例如 `~/.zshrc`）在 `ask` 下需要确认，Headless CLI 需要显式授权。规则参考由 [permission-rules.md](../permission-rules.md) 维护，实施见[工单 04](../../.scratch/session-workspaces/issues/04-session-access-scope.md)。
