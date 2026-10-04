Status: ready-for-agent

# Spec: 权限规则（Permission Rule）与 compaction 后 reminder 重发

来源：[权限规则与 sandbox](../agent-core-roadmap/issues/11-permission-rules-and-sandbox.md)；基于 [地基 C：工具调用前后拦截点](../agent-core-roadmap/issues/03-tool-call-interception.md)。另并入地图 Not yet specified 中的 reminder 缺陷。

## Problem Statement

用户现在只能按工具名放行（`allowTools`），粒度太粗：想放行 `git status` 就得放行整个 bash，想禁止读 `~/.ssh` 却没有办法。只读工具在任何模式下都直接放行，full-access 下更是什么都拦不住。审批框的"允许此工具"会把整个工具在本 session 放开，一次点击放宽太多。另外项目级 `.neant/settings.json` 的 `allowTools` 直接覆盖用户配置，仓库可以自行放宽权限，和"项目只能收窄"的意图相反。

另有一个缺陷：compaction 后，skills、MCP、Project Instructions、date 的 system reminder 不会重发。去重时对照的是整份 transcript，而压缩后的模型 context 已经丢了这些 reminder。模型因此在长 session 里静默失去项目说明和 skill 列表，越晚越难查。

## Solution

用户在 settings 的 `permissions.{allow,ask,deny}` 里写 Permission Rule，可按工具名、bash 命令文本或文件路径匹配。规则在 Permission Mode 之前判定：用户写下的 deny 和 ask 在任何模式下都生效，deny 原因附带规则原文回给模型。用户层与项目层合并，项目层的 allow 只在 trusted project 生效。`allowTools` 删除，CLI 的 `--allow-tools` 改为会话级 allow 规则。审批框的"本 session 允许"改为生成更窄的内存规则：bash 记精确命令，文件工具记所在目录，其他工具记工具名。

实现时连带完成地基 C 的固定阶段重构：权限判定拆成具名阶段放进 permissions 模块，本轮只落地"规则 → Permission Mode → 交互"三段，hooks 和放行后阶段由各自工单接入。

compaction 时，把全部 reminder source 一起立即重新注入；reminder 去重只对照最近一次 compaction 之后的 transcript。

## User Stories

1. 作为用户，我想写 `allow: ["bash(git status*)"]`，以便常用的只读 git 命令不再每次询问。
2. 作为用户，我想写 `deny: ["bash(rm -rf *)"]`，以便危险命令在任何模式下都被拒绝。
3. 作为用户，我想写 `ask: ["bash(git push *)"]`，以便在 full-access 下推送前仍被询问。
4. 作为用户，我想写 `deny: ["read(~/.ssh/**)"]`，以便 agent 读不到我的密钥，即使 read 默认放行。
5. 作为用户，我想写 `edit(src/**)` 这类相对路径规则，以便它按项目根解析。
6. 作为用户，我想用绝对路径和 `~/` 写规则，以便约束项目外的文件。
7. 作为用户，我想写裸名 `mcp__github__*`，以便按工具名放行一组 MCP 工具。
8. 作为用户，我想在规则写错（未知工具带 specifier、空串、括号不闭合）时，让加载报错并指出文件和规则，以便及时改正。
9. 作为用户，我想让 `git status && rm -rf x` 命中 `rm -rf *` 的 deny，以便危险命令无法用拼接藏起来。
10. 作为用户，我想让 `git status | head` 只在两段都被 allow 时才自动放行，以便 allow 不会被拼接带出未授权的命令。
11. 作为用户，我想让含 `$(…)`、反引号、`<(…)`、heredoc 的命令永远不被 allow 规则自动放行，以便拆不准时偏向询问。
12. 作为用户，我想让含 `$(…)` 的命令仍能被 deny 规则拦住，以便 deny 不因语法复杂失效。
13. 作为用户，我想让引号内的 `&&`、`;`、`|` 不被当作分隔符，以便 `echo "a && b"` 按一条命令判定。
14. 作为用户，我想让 deny 规则在 full-access 下照常生效，以便"不再询问"不等于"什么都放"。
15. 作为用户，我想让 ask 规则在 full-access 下照常询问，以便显式要求过目的操作一定经过我。
16. 作为用户，我想让 ask 规则在 auto-review 下直接问我、不交给 Permission Review，以便 LLM 评审不能替我做决定。
17. 作为用户，我想让 allow 规则在 ask 和 auto-review 下跳过询问和评审，以便放行规则在各模式下行为一致。
18. 作为用户，我想让同时命中 allow 和 deny 时 deny 生效，以便取最严的语义可预期。
19. 作为用户，我想让用户层与项目层的 deny / ask 合并，以便项目可以为自己追加限制。
20. 作为用户，我想让未信任项目里的项目层 allow 被忽略并给出警告，以便克隆来的仓库不能给自己放权。
21. 作为用户，我想让 trusted project 的项目层 allow 生效，以便自己的项目可以共享放行规则。
22. 作为用户，我想用 `--allow-tools` 在命令行给出会话级 allow 规则（与 settings 同语法），以便一次性放行而不改配置。
23. 作为用户，我想在 settings 里还写着 `allowTools` 时收到明确的校验错误，以便知道要迁移到 `permissions.allow`。
24. 作为用户，我想通过项目内指向 `~/.ssh` 的软链读取时仍被 `read(~/.ssh/**)` 拒绝，以便 symlink 绕不过 deny。
25. 作为用户，我想让 allow 只按 realpath 匹配，以便项目内的软链不能借项目路径的 allow 读写项目外的文件。
26. 作为用户，我想让 glob / grep 省略 `path` 时按 cwd 判定，以便路径规则对它们也生效。
27. 作为模型，我想在被规则拒绝时收到 `Denied by permission rule: <规则>`，以便换个办法，而不是重复撞同一条规则。
28. 作为 frontend 开发者，我想让 `permission_denied` 事件带上 `by`（`rule` / `user` / `review`）和可选的 `rule`，以便显示拒绝来源。
29. 作为 TUI 用户，我想在被规则拒绝的工具卡上看到规则原文，以便知道是哪条配置挡住的。
30. 作为 TUI 用户，我想在 bash 审批框看到"本 session 允许此命令"，以便只放行这一条精确命令。
31. 作为 TUI 用户，我想在文件工具审批框看到"本 session 允许此目录"，以便放行该文件所在目录下的同类操作。
32. 作为 TUI 用户，我想在其他工具审批框看到"本 session 允许此工具"，以便沿用现有的整工具放行。
33. 作为 TUI 用户，我想让"本 session 允许"同时放行队列里已经被新规则覆盖的待审请求，以便不必重复点。
34. 作为 TUI 用户，我想让"本 session 允许"在 resume 后失效，以便临时放行不会悄悄延续。
35. 作为 TUI 用户，我想让"本 session 允许"越不过 deny 规则，以便一次点击不会抵消配置里的禁止。
36. 作为 Headless CLI 用户，我想让命中 ask 规则的调用按 deny 处理，以便无人值守时 fail-closed。
37. 作为 Headless CLI 用户，我想在 stream-json 里看到带 `by` / `rule` 的 `permission_denied`，以便脚本区分拒绝原因。
38. 作为模型，我想在 compaction 后立即重新看到 Project Instructions、skills 列表和 MCP 说明，以便压缩后仍遵守项目约定。
39. 作为模型，我想在 compaction 后的下一个 run 里不重复收到刚重发过的 reminder，以便 context 不被重复内容占用。
40. 作为用户，我想让 compaction 后的 session 在 resume 时恢复出同样的 reminder，以便 resume 前后模型看到的一致。
41. 作为维护者，我想让权限判定由具名的固定阶段组成，以便 hooks、plan mode、checkpoint 按地基 C 的顺序接入。
42. 作为维护者，我想让规则判定是一个纯函数，以便用表驱动测试覆盖拆分和匹配的边界情况。

## Implementation Decisions

### 固定阶段（地基 C 的本轮落地）

- 现在 session 里的 `beforeToolCall` 闭包拆进 permissions 模块：由一个入口按固定顺序调用具名阶段（规则 → Permission Mode → 交互），不对外暴露注册 API。Permission Review 批量预启动的逻辑保留在模式阶段，行为不变。
- 每个阶段返回 `allow | deny(reason) | ask(reason) | 无意见`；合成规则为：规则阶段表态 deny 时直接拒绝；表态 ask 时跳过模式阶段（也跳过 review），直接交互；表态 allow 时跳过模式阶段；无意见时交给模式阶段给默认值。
- 模式阶段即现在的 `decidePermission`：只读工具（read / glob / grep / skill / ask_user_question / todo_write）是模式默认 allow，full-access 把模式给出的 ask 变成 allow；不再接收 `allowTools`。
- hooks 阶段与放行后阶段本轮不建空壳，由 hooks / checkpoint 工单按地基 C 的顺序插入。

### Permission Rule

- 设置项：`permissions: { allow?: string[], ask?: string[], deny?: string[] }`，加入 shared 的 settings schema。删掉 `allowTools`；schema 默认不拒绝多余字段，所以 `loadSettings` 在任一层出现 `allowTools` 时显式报错，提示迁移到 `permissions.allow`。
- 规则语法：`tool(specifier)` 或裸名 glob。
  - 裸名：对工具名做 `Bun.Glob` 匹配（`mcp__*`、`web_fetch`）。
  - `bash(pattern)`：对命令文本做 glob 匹配，`*` 可跨空格；匹配前去掉首尾空白。
  - `read / edit / write / glob / grep(pattern)`：pattern 中以 `~/` 开头的展开为 home；相对路径按 cwd 拼成绝对路径；之后对规范化后的目标路径做 `Bun.Glob` 匹配。不做 gitignore 语义。
  - 其他工具带 specifier、空串、括号不闭合：加载时报错，错误信息含文件路径和规则原文。
- 规则在加载时解析成结构化形式，后续判定只用结构化规则。
- 判定是一个纯函数：输入为规则集、工具名、已校验的参数、cwd、home；输出为 `allow | ask | deny`（带命中的规则原文）或无意见。它也是本轮新增的测试接缝。
- 文件工具的目标路径：read / edit / write 取 `path`；glob / grep 取 `path`，缺省为 cwd。先 resolve；路径存在时再取 realpath，不存在时对最近一个存在的祖先取 realpath，再拼上剩下的部分。deny / ask 对 resolve 后和 realpath 后两个路径都匹配，任一命中即生效；allow 只匹配 realpath 后的路径。
- bash 复合命令：一个只认单引号、双引号和反斜杠转义的小 splitter，按 `&&`、`||`、`;`、`|`、`&`、换行拆段。
  - deny / ask：对整串和每一段都匹配，任一命中即生效。
  - allow：每一段都必须被某条 allow 命中。
  - 命令含 `$(`、反引号、`<(`、`>(`、`<<` 时，跳过 allow 匹配，交给模式阶段；deny / ask 照常。
  - 引号不闭合时，按"拆不准"处理。
- 优先级：deny > ask > allow，跨来源统一取最严。

### 配置层级与来源

- 规则来源：用户 settings、项目 settings、CLI `--allow-tools`（会话级 allow）、"本 session 允许"（会话内存 allow）。前三类在 session 创建时合并，第四类在运行中追加。
- 项目 settings 的 `permissions.deny` / `ask` 总是与用户层合并（各自追加）。项目层的 `permissions.allow` 只在 Trusted Project 下合并；否则丢弃并发出警告，与项目级 `.mcp.json` 共用同一个信任判定。
- `loadSettings` 不再处理 `allowTools`。session 选项 `allowTools` 改为 `allowRules`（与 settings 同语法），由 CLI / TUI 的 `--allow-tools` 填入，参数名不变。
- 规则解析错误按设置错误处理：会话启动失败，错误信息指出来源（文件路径或 `--allow-tools`）。

### "本 session 允许"

- `onPermissionAsk` 的返回值从 `"allow" | "deny"` 扩为 `"allow" | "deny" | "allow-session"`。返回 `allow-session` 时，Agent Core 为这次调用生成一条会话级 allow 规则并放行这次调用：
  - bash：`bash(<去掉首尾空白的整条命令>)`，命令里的 `*` 需转义，按字面匹配；命令属于"拆不准"类型时，规则仍按字面匹配整串（只放行这一条命令）。
  - 文件工具：`<tool>(<目标 realpath 的所在目录>/**)`；glob / grep 的目标本身是目录时，取该目录 `/**`。
  - 其他工具：裸工具名。
- 会话级规则只存在内存里，不写 transcript，resume 后失效；子代理按引用共享（地基 C）。它们照常经过规则阶段，因此越不过 deny / ask 规则。
- `PermissionAskRequest` 新增 `sessionAllow: { kind: "command" | "directory" | "tool"; rule: string }`，frontend 据此显示按钮文案；auto-review 下 frontend 照旧不提供这一项（沿用现状）。
- TUI 去掉自己维护的"已放行工具"集合，改为：用户选"本 session 允许"后，把队列中仍在等待的同 session 请求交回 Agent Core 重新判定（重新走规则阶段），命中新规则的自动放行，其余继续排队。实现方式为 Agent Core 在追加会话规则后，对挂起的 ask 逐个重判；frontend 通过请求的 `signal` 收到撤销，从队列里移除。

### 拒绝反馈

- 规则拒绝时 tool result 为 `Denied by permission rule: <规则原文>`。用户拒绝、review 拒绝的文案沿用现状。
- `permission_denied` 事件改为 `{ type, toolCallId, toolName, by: "rule" | "user" | "review", rule?: string }`（hooks 工单再加 `hook`）。shared 事件类型同步，stream-json 自动带出，属于允许的破坏性变更。
- TUI 工具卡在 `by: "rule"` 时显示规则原文，文案走 i18n。

### compaction 后 reminder 重发

- compaction 完成后，立即重新注入所有 reminder source 的当前内容：date、user / project instructions、skills、mcp、frontend 传入的 `reminderSources`、Tool State。environment 是一次性快照，不重发。对照基准为空，有内容就发。
- reminder 去重只对照最近一次 compaction 之后的 transcript，不再对照全量 transcript（现在只有 Tool State source 这样做）。原来区分 Tool State source 的特例去掉，所有 source 统一按这条规则处理。
- 恢复 context 时，紧跟在 compaction 之后的 reminder 块要放在 retained tail 之前；可放进这个块的 source 集合扩为上面的全部 source，保证 resume 前后模型看到的一致。
- Project Instructions 等 source 目前只在首次 run 时登记；compaction 重发时也要登记它们，所以 source 列表的组装需要与"是否首次 run"解耦（environment 除外）。

## Testing Decisions

- 好的测试只看外部行为：工具有没有执行、模型收到的 tool result 文本、发出的事件、`onPermissionAsk` 是否被调用以及收到的请求。不断言阶段函数内部调用顺序或私有数据结构。
- **规则判定纯函数**（新接缝，表驱动）：语法解析和错误、裸名 glob、bash glob、复合命令拆分（引号、转义、各分隔符、拆不准的写法、不闭合引号）、allow 需要每段都命中、deny 任一段命中、路径 resolve / `~` / 相对路径、symlink（在临时目录里真实建软链）、glob / grep 缺省 path、取最严。
- **e2e `createSession` + faux model**（主接缝，prior art 为 `tests/e2e/permissions.test.ts`、`permission-review.test.ts`）：三种模式下规则的叠加（deny 在 full-access 下仍拒；ask 规则在 full-access 下仍问；ask 规则在 auto-review 下不发起 review）；deny 文案和 `permission_denied` 的 `by` / `rule`；`allow-session` 生成的规则对后续调用生效、越不过 deny、resume 后失效；挂起的同类 ask 被重判放行；`allowRules` 选项；Headless 下 ask 规则按 deny 处理。
- **settings 加载**（prior art 为 `tests/config/settings.test.ts`）：用户层 + 项目层合并；非 trusted 时项目 allow 被忽略并告警；trusted 时生效；旧 `allowTools` 报错；非法规则报错时带文件和规则。
- **compaction reminder**（prior art 为 `tests/e2e/compaction.test.ts`、`reminders.test.ts`、`todo-reminders.test.ts`）：compaction 后的下一次模型请求里含 Project Instructions / skills / date reminder；下一个 run 不重复发；resume 后 `session.messages` 与 compaction 当时一致；environment 不重发。先写会失败的测试复现缺陷。
- **TUI**（prior art 为 `apps/neant-tui/tests` 里的 interactions 与 permission dialog 测试）：三种按钮文案按 `sessionAllow.kind` 显示；选中后回复 `allow-session`；被撤销的请求从队列移除；工具卡显示规则原文。
- **CLI**（prior art 为 `apps/neant-cli/tests/main.test.ts`）：`--allow-tools` 接受规则语法、非法规则报错；stream-json 里的 `permission_denied` 带 `by`。

## Out of Scope

- sandbox（OS 级写入隔离）：已划出路线图。
- hooks 阶段、放行后阶段、plan mode 的内置 deny：分别属于各自工单，本轮只保证阶段顺序能让它们插进来。
- 持久化"一直允许"（`settings.local.json` 或写回 settings）：按决定不做。
- gitignore 语义的路径匹配（`!` 取反、目录尾斜杠）。
- 用 tree-sitter 等完整 shell 解析器拆分命令；bash 规则不是安全边界。
- 包装命令剥离（`timeout`、`env`、`nice` 前缀等），CC 有，后续按需。
- web_fetch 的域名 specifier：web_fetch 工具尚未存在，由该工单决定。
- 子代理的收窄配置：属于子代理工单；本轮只保证规则集可以按引用共享。

## Further Notes

- 文档（设置示例、`--help`）需写明：bash 规则按文本匹配，不是安全边界。
- 修掉项目级 `allowTools` 能放宽权限的漏洞，属于安全相关改动；实现时注意不要留下任何项目层可以写入 allow 的旁路。
- `CONTEXT.md` 已有 Permission Rule、Permission Mode、Trusted Project 条目；实现时如有措辞不一致，以 `CONTEXT.md` 为准。
