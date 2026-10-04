# 11: 权限规则与 sandbox

Type: grilling
Status: resolved
Blocked by: 03, 05

## Question

"限制工具能做什么"的两层：权限规则（按 bash 命令前缀、文件路径放行 / 拒绝），以及 sandbox（OS 级写入隔离，优先级最低，可先只定接口位置）。

需定：规则语法与匹配（复合命令拆分）；allow / deny / ask 优先级及与 Permission Mode 的叠加；配置层级（项目级能否放宽，比照现有 `allowTools` 只允许项目收窄还是放宽）；审批对话框"本 session 一直允许"是否改为生成规则；sandbox 是否进本轮实现（按地基 C，sandbox 不进拦截链，属于 bash 工具的执行环境）。

## Answer

2026-10-04 grilling 结论（`CONTEXT.md` 新增 Permission Rule，并同步了 Permission Mode 和 Trusted Project 条目）：

1. **语法**：settings 里写 `permissions: { allow: [], ask: [], deny: [] }`，每条为 `tool(specifier)` 或裸工具名 glob。
   - bash：`bash(git commit *)`，对命令文本做 glob 匹配，`*` 可跨空格。
   - 文件工具（read / edit / write / glob / grep）：`edit(src/**)`。路径 resolve 成绝对路径后用 `Bun.Glob` 匹配；相对路径按项目根算，支持 `~/` 和绝对路径；不做 gitignore 语义。
   - 裸名：`mcp__github__*`、`web_fetch`，只匹配工具名。
   - 其他工具写 specifier 时，加载阶段直接报错。
2. **复合命令**：用一个只认引号的小 splitter，按 `&&`、`||`、`;`、`|`、换行拆段。deny 或 ask 任一段命中即生效；allow 要求每一段都命中。含 `$(`、反引号、`<(`、heredoc 的命令不参与 allow 匹配（交给 Permission Mode）；deny 仍按整串和能拆出的段匹配。文档注明 bash 规则不是安全边界。
3. **配置层级**：只有用户层 `~/.neant/settings.json` 和项目层 `.neant/settings.json`，不加 `settings.local.json`。deny 和 ask 各层合并。项目层的 allow 只在 `trustedProjects` 命中时加载，否则忽略并告警（修掉现在项目级 `allowTools` 可以放宽权限的漏洞）。`allowTools` 直接删除，不做迁移；CLI 的 `--allow-tools` 保留，作为会话级 allow 规则。
4. **与 Permission Mode 叠加**：规则阶段排在模式阶段之前。用户写的 ask 和 deny 在 full-access 下照常生效。auto-review 下命中 ask 规则时直接问用户，不经过 Permission Review。内置的只读放行（read / glob / grep 等）是模式阶段的默认值，所以 `deny: ["read(~/.ssh/**)"]` 能生效。Headless 下 ask 照旧按 deny 处理。
5. **"本 session 允许"**：生成只存在于当前 session 内存里的 allow 规则，不持久化，resume 后失效。bash 生成精确整条命令 `bash(<cmd>)`，不猜前缀；文件工具生成 `edit(<所在目录>/**)`；其他工具生成裸工具名。按钮文案改为"本 session 允许此命令 / 此目录 / 此工具"。
6. **路径规范化**：先 resolve，路径存在时再 realpath。deny 对规范化前后两个路径都做匹配，任一命中即拒；allow 只认 realpath。glob / grep 缺省 `path` 时按 cwd 算。
7. **deny 反馈**：工具结果返回 `Denied by permission rule: <规则原文>`；`permission_denied` 事件带 `by: "rule"` 和 `rule` 字段，TUI 工具卡显示这条规则。
8. **sandbox**：本轮不做，也不预留接口，划为 Out of scope。

实现时连带完成地基 C 的固定阶段重构（把 `beforeToolCall` 拆成多个阶段放进 `permissions/`）。下一步写 spec，再按 TDD 实现。
