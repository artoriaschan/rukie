Status: ready-for-agent

# Spec: Hooks

来源：[hooks](../agent-core-roadmap/issues/12-hooks.md)；基于 [地基 C：工具调用前后拦截点](../agent-core-roadmap/issues/03-tool-call-interception.md)、[权限规则与 sandbox](../agent-core-roadmap/issues/11-permission-rules-and-sandbox.md)、[地基 A：交互通道](../agent-core-roadmap/issues/01-interaction-channel.md)、[子代理](../agent-core-roadmap/issues/06-subagent.md)；参考 Claude Code hooks（本地 `~/Workspaces/agent/claude-code` 源码 + 官方 hooks 文档，冲突以文档为准）、调研 [权限规则 / hooks / checkpoint](../agent-core-roadmap/issues/05-research-rules-hooks-checkpoint-prior-art.md)。

## Problem Statement

用户想在 agent 的关键时刻插入自己的检查和自动化：改完文件自动跑 formatter、拦掉碰生产配置的命令、测试没过就别让 agent 收工、每次提交 prompt 附上当前分支信息、agent 等用户审批时发桌面通知。现在 Neant 只有权限规则和 Permission Mode，规则只能按模式匹配做 allow / deny / ask，不能运行用户代码、不能改写参数、不能向模型补充上下文、也不能让即将结束的 run 继续。用户在 Claude Code 里已经写过这类脚本，到 Neant 里没地方挂。

## Solution

Neant 支持 Hook：用户在 settings 里为生命周期事件配置外部程序，协议对齐 Claude Code（stdin JSON、退出码、`hookSpecificOutput`），名字换成 Neant 的（工具名、Permission Mode 取值、`NEANT_PROJECT_DIR`）。

- 工具调用前的 hook 可以阻断、要求询问、放行、改写参数；改写后的参数仍要过权限规则，hook 的 allow 越不过规则的 deny。
- 工具调用后的 hook 可以替换结果、给模型附加反馈。
- 用户提交 prompt、session 开始时的 hook 可以注入上下文，前者还能拦下 prompt。
- run 即将结束时的 Stop hook 可以拦下并让 agent 继续，连续上限 8 次。
- 权限询问、权限拒绝、compaction 前后、子代理开始结束、交互开始、session 结束都有对应事件。
- 项目层 hook 等同执行任意代码，只在 Trusted Project 下加载。

## User Stories

### 配置与信任

1. 作为用户，我想在 `~/.neant/settings.json` 的 `hooks.<Event>[]{matcher, hooks[]}` 里配置 hook，以便所有项目都生效。
2. 作为用户，我想在项目的 `.neant/settings.json` 里配置 hook，以便只对这个项目生效。
3. 作为用户，我想未被信任的项目里的项目层 hook 不被加载并收到告警，以便克隆来的仓库不能借 hook 执行任意代码。
4. 作为用户，我想用户层与项目层的 hook 合并执行，完全相同的 hook 只跑一次，以便两层重复配置不会触发两次。
5. 作为用户，我想配置格式与 Claude Code 一致，以便照着 CC 文档就能写。
6. 作为用户，我想 settings 里 hook 配置写错时加载阶段就报错并指出位置，以便不会默默失效。
7. 作为用户，我想在子代理类型的 `agents/*.md` frontmatter 里声明 hook，只在该子代理运行时生效，以便给 explore 之类的类型加专属检查。
8. 作为用户，我想 frontmatter 里写的 `Stop` 自动当作 `SubagentStop`，以便和 CC 的写法一致。
9. 作为用户，我想项目层 `agents/*.md` 的 hook 同样只在 Trusted Project 下加载，以便信任闸门没有旁路。

### 匹配

10. 作为用户，我想用 `bash`、`edit|write` 这样的 matcher 精确匹配工具名或名字列表，以便只对关心的工具触发。
11. 作为用户，我想 matcher 含其他字符时按正则匹配（如 `mcp__github__.*`），以便一次匹配一批 MCP 工具。
12. 作为用户，我想 matcher 省略、为空或为 `*` 时匹配全部，以便写全局 hook。
13. 作为用户，我想在单个 hook 上写 `if: "bash(git push *)"` 这样的 Permission Rule，以便只在特定命令或路径上触发，不必在脚本里自己解析。
14. 作为用户，我想 SessionStart、PreCompact、Notification、SessionEnd、子代理事件的 matcher 分别匹配 `source`、`trigger`、`notification_type`、`reason`、`agent_type`，以便细分触发场景。

### 协议

15. 作为 hook 作者，我想从 stdin 读到一个 JSON，含 `session_id`、`transcript_path`、`cwd`、`permission_mode`、`hook_event_name` 和事件专属字段，以便脚本知道上下文。
16. 作为 hook 作者，我想 exit 0 时 stdout 的 JSON 被解析为输出，以便表达结构化决定。
17. 作为 hook 作者，我想 exit 2 表示阻断、stderr 作为原因，以便最简单的脚本也能拦截。
18. 作为 hook 作者，我想其他退出码只算非阻断错误、动作照常进行，以便脚本自身的 bug 不会卡住 agent。
19. 作为 hook 作者，我想用 `continue: false` 加 `stopReason` 结束整个 run，以便遇到严重问题时彻底停下。
20. 作为 hook 作者，我想用 `systemMessage` 给用户显示一条提示，以便告知用户但不打扰模型。
21. 作为 hook 作者，我想环境变量 `NEANT_PROJECT_DIR` 指向项目根，以便脚本定位项目文件。
22. 作为 hook 作者，我想 `tool_name` 是 Neant 的工具名（`bash`、`edit`、`mcp__<server>__<tool>`），以便与 Permission Rule 写法一致。
23. 作为 hook 作者，我想单条 `additionalContext` 过长时被截断到上限，以便一个失控的脚本不会撑爆上下文。

### hook 类型、超时与失败

24. 作为用户，我想写 `command` hook，以便运行任意 shell 命令。
25. 作为用户，我想写 `http` hook，把输入 POST 到一个 URL，以便接入已有的服务。
26. 作为用户，我想写 `mcp_tool` hook，调用已连接 MCP server 的工具，以便复用 MCP 能力。
27. 作为用户，我想写 `prompt` hook，用 LLM 判断一句话规则（如"不准改测试来让测试通过"），默认用 review model，以便不写脚本也能做语义检查。
28. 作为用户，我想写 `agent` hook，让一个能读文件的小 agent 去核查，以便做需要查看代码的检查。
29. 作为用户，我想 command hook 可以设 `async`，在后台运行不阻塞 agent，以便做日志、通知之类的副作用。
30. 作为用户，我想每个 hook 有与 CC 一致的默认超时，并可单独设 `timeout`，以便慢脚本不会无限卡住。
31. 作为用户，我想 hook 超时、崩溃或输出坏 JSON 时 agent 照常继续，并在 TUI 里看到告警，以便知道 hook 坏了但不被卡住。

### 工具调用前（PreToolUse）

32. 作为用户，我想 PreToolUse hook 返回 deny 加原因，原因作为工具结果回给模型，以便模型知道为什么被拦。
33. 作为用户，我想 PreToolUse hook 返回 ask，即使在 full-access 下也询问我，以便对特定操作保留人工确认。
34. 作为用户，我想 PreToolUse hook 返回 allow 跳过询问和 auto-review，以便我信任的操作不再打断我。
35. 作为用户，我想 hook 的 allow 越不过权限规则的 deny 和 ask，以便规则始终是最后防线。
36. 作为用户，我想 PreToolUse hook 用 `updatedInput` 改写参数，改写后的参数再按权限规则判定，以便 hook 不能被用来绕过规则。
37. 作为用户，我想改写后的参数先按工具 schema 校验，不合法就拒绝这次调用并告诉模型原因，以便坏改写不会让工具崩溃。
38. 作为用户，我想多个 hook 命中同一调用时并行执行、各自拿到原始输入，以便我的 hook 不受别人改写的影响。
39. 作为用户，我想多个 hook 的判定取最严（deny > ask > allow），以便任一 hook 都能拦下。
40. 作为用户，我想 PreToolUse hook 的 `additionalContext` 作为 system reminder 附在这次工具结果上，以便给模型补充说明。
41. 作为用户，我想被 hook 拒绝时 `permission_denied` 事件带 `by: "hook"`，TUI 工具卡显示是 hook 拦的，以便区分规则、hook、用户和 review 的拒绝。
42. 作为用户，我想内置工具、MCP 工具和 `skill` 工具都触发工具类 hook，以便一套 hook 覆盖全部工具。

### 权限询问与拒绝

43. 作为用户，我想调用即将询问我时先触发 PermissionRequest hook，hook 可以代我 allow 或 deny，以便常见审批自动处理。
44. 作为用户，我想 PermissionRequest hook allow 时可以改写参数，改写后仍要过规则，以便代答同样受规则约束。
45. 作为用户，我想 PermissionRequest hook 可以通过 `updatedPermissions` 加一条 session 内存 allow 规则或切换 Permission Mode，以便一次授权覆盖后续同类调用。
46. 作为用户，我想 `updatedPermissions` 写到 session 之外的 destination 时被忽略并告警，以便 Neant "不持久化一直允许"的约定不被 hook 打破。
47. 作为用户，我想 PermissionRequest hook deny 时可以带 `message`，并用 `interrupt` 中止整个 run，以便严重违规直接停下。
48. 作为 Headless CLI 用户，我想 PermissionRequest hook 在 Headless 下也触发，没有 hook 拍板时照旧 deny，以便无人值守时也能用 hook 做审批。
49. 作为用户，我想任何拒绝（规则、hook、用户、review）都触发 PermissionDenied hook，输入带 `by`、`reason`，规则拒绝还带 `rule`，以便统一记录或通知。
50. 作为用户，我想 auto-review 拒绝时 PermissionDenied hook 能返回 `retry: true`，让模型知道可以调整后重试，以便误判不会让模型直接放弃。
51. 作为用户，我想 `retry` 对规则、hook、用户的拒绝不生效，以便模型不会对硬性规则反复撞墙。

### 工具调用后

52. 作为用户，我想工具成功后触发 PostToolUse，输入带 `tool_input`、`tool_response`、`tool_use_id`、`duration_ms`，以便做格式化、记录之类的后处理。
53. 作为用户，我想 PostToolUse hook 用 `decision: "block"` 加原因，把反馈附在结果旁交给模型，以便告诉模型"lint 没过，改一下"。
54. 作为用户，我想 PostToolUse hook 用 `updatedToolOutput` 替换工具结果，形状不合法时忽略并告警，以便过滤敏感输出。
55. 作为用户，我想工具失败时触发 PostToolUseFailure，输入带 `error`、`is_interrupt`，只能注入 `additionalContext`，以便给失败补充排查提示。
56. 作为用户，我想参数校验失败和权限拒绝不触发 PostToolUseFailure，以便它只代表工具真正执行失败。

### prompt 与 session 生命周期

57. 作为用户，我想提交 prompt 时触发 UserPromptSubmit，hook 可以注入 `additionalContext`，以便自动附上分支、工单等信息。
58. 作为用户，我想 UserPromptSubmit hook 可以 block 我的 prompt 并告诉我原因，prompt 不进 transcript 也不发给模型，以便拦下误贴的密钥。
59. 作为用户，我想 UserPromptSubmit hook 的纯文本 stdout 也当作上下文注入，以便最简单的 `echo` 就能用。
60. 作为用户，我想新建、resume、fork session 时触发 SessionStart（`source` 分别为 startup / resume / fork），hook 可以注入上下文，以便每个 session 开头带上项目状态。
61. 作为用户，我想 compaction 后以 `source: "compact"` 再触发 SessionStart，以便被摘要掉的关键上下文重新注入。
62. 作为用户，我想 session 结束时触发 SessionEnd，总预算很短不拖慢退出，以便做清理。
63. 作为前端开发者，我想 `Session` 有 `dispose()`，关闭 MCP 连接并触发 SessionEnd，以便 TUI 退出和 CLI 结束时有统一的收尾点。

### Stop 与子代理

64. 作为用户，我想 run 即将结束时触发 Stop，输入带 `last_assistant_message` 和 `stop_hook_active`，以便检查 agent 的收尾。
65. 作为用户，我想 Stop hook 返回 block 加原因时 run 不结束，原因作为一条 user 消息让模型继续，以便"测试不过不许收工"。
66. 作为用户，我想连续 block 超过 8 次后被忽略并告警、run 结束，以便写错的 hook 不会死循环。
67. 作为用户，我想 Stop hook 先于 Goal 判定，hook 续跑不算 goal round，以便两种续跑互不干扰。
68. 作为用户，我想子代理里的工具调用也触发工具类 hook，输入带 `agent_id`、`agent_type`，以便子代理同样受约束。
69. 作为用户，我想子代理开始时触发 SubagentStart，hook 可以向子代理注入上下文，以便给子代理额外指示。
70. 作为用户，我想子代理即将结束时触发 SubagentStop，可以 block 让它继续，父 session 等它真正结束才收到通知，以便子代理的产出也能被把关。

### compaction 与通知

71. 作为用户，我想 compaction 前触发 PreCompact（`trigger: "auto"`），hook 可以阻止这次 compaction，以便关键时刻不丢上下文。
72. 作为用户，我想 compaction 后触发 PostCompact，输入带摘要，以便记录或备份。
73. 作为用户，我想每次 Interaction 开始时触发 Notification，`notification_type` 区分权限询问、提问、plan 评审、MCP 授权，以便 agent 等我时收到桌面通知。

### 呈现与 Headless

74. 作为 TUI 用户，我想 hook 的告警、`systemMessage`、`stopReason` 在界面上可见，以便知道 hook 做了什么。
75. 作为 TUI 用户，我想 Stop hook 续跑时看到"Stop hook 反馈"标记的 user 消息，以便明白 agent 为什么没停。
76. 作为 Headless CLI 用户，我想 hook 照常执行，hook 返回 ask 时按 deny 处理，以便无人值守时 fail-closed。
77. 作为 stream-json 消费者，我想 hook 产生的告警和续跑以事件形式出现，以便外部工具感知。

## Implementation Decisions

### 新模块：`hooks/`（Agent Core）

- 一个 `CONTEXT.md` 概念一个目录：新增 `hooks/`，经 `index.ts` 暴露。职责：配置合并与去重、按事件与 matcher / `if` 选出 hook、执行五种类型、解析输出、合并多 hook 结果。不知道 Session 内部，调用方传入事件输入与执行所需依赖（cwd、项目根、review model 的 streamFn、MCP 客户端、warning 出口）。
- 对外形状（示意）：`createHooks({ settings, agentHooks?, ... })` 返回 `run(event, input, { signal, matchQuery })`，产出该事件的合并结果（判定、改写参数、附加上下文、block 原因、`continue`/`stopReason`、`systemMessage`、告警列表）。每个事件的合并结果类型独立，调用方只看到与该事件相关的字段。
- 子代理类型带 frontmatter hooks 时，子 session 用"父配置 + 类型 hooks"构造自己的 hooks 实例；父配置按引用共享（地基 C）。

### 配置（`@neant/shared` settings schema + `config/`）

- `SettingsSchema` 新增 `hooks`：`Record<EventName, Array<{ matcher?: string; hooks: HookHandler[] }>>`。`HookHandler` 为 `type` 判别联合：
  - 通用：`if?`（一条 Permission Rule）、`timeout?`（秒，可为小数）、`statusMessage?`。
  - `command`：`command`、`args?`（exec 形式，不经 shell）、`async?`、`asyncRewake?`、`shell?`（仅 `bash`）。
  - `http`：`url`、`headers?`、`allowedEnvVars?`。
  - `mcp_tool`：`server`、`tool`、`input?`（`${tool_input.x}` 替换）。
  - `prompt` / `agent`：`prompt`（`$ARGUMENTS` 替换为输入 JSON）、`model?`。
- 事件名集合：PreToolUse、PermissionRequest、PermissionDenied、PostToolUse、PostToolUseFailure、UserPromptSubmit、SessionStart、Stop、SubagentStart、SubagentStop、PreCompact、PostCompact、SessionEnd、Notification。未知事件名、未知字段、非法 `if` 规则在加载时报错，与现有 settings 校验一致。
- `loadSettings`：用户层 hooks 总是加载；项目层 hooks 仅当 `isTrustedProject` 命中时加载，否则丢弃并经 warnings 告警（与项目级 allow 同一闸门）。两层按"用户层在前、项目层在后"拼接。
- 去重键：command = shell + command + args + `if`；http = url + `if`；mcp_tool = server + tool + input + `if`；prompt / agent = prompt + model + `if`。键相同只保留一个。
- 子代理类型 frontmatter（`agents/*.md` 的 `Metadata` schema）新增可选 `hooks`，格式同 settings；`Stop` 键改名为 `SubagentStop`。项目层目录（cwd 下的 `.neant|.claude|.agents/agents`）里的类型在非 trusted 时丢弃 hooks 并告警，其余定义照常加载。

### 匹配

- matcher：`*`、空、省略 = 全部；仅含 `[A-Za-z0-9_|,]` 时按 `|`/`,` 拆成精确名列表；否则编译为不锚定 JS RegExp，非法正则加载时报错。
- 匹配字段：工具类事件（PreToolUse、PermissionRequest、PermissionDenied、PostToolUse、PostToolUseFailure）= `tool_name`；SessionStart = `source`；Pre/PostCompact = `trigger`；Notification = `notification_type`；SessionEnd = `reason`；SubagentStart/Stop = `agent_type`；UserPromptSubmit、Stop 无 matcher（写了也忽略）。
- `if`：复用 `permissions/` 的规则解析与匹配（含复合命令拆段、路径规范化），仅在工具类事件上评估；非工具事件上写了 `if` 的 hook 永不运行（加载时告警）。命中语义：任一段命中即运行。

### 执行与协议

- 输入通用字段：`session_id`、`transcript_path`（Neant JSONL 绝对路径）、`cwd`、`permission_mode`（ask / auto-review / full-access）、`hook_event_name`；子代理内另带 `agent_id`、`agent_type`。事件专属字段照 CC（见下文各事件）。
- command：`sh -c`（有 `args` 时直接 exec），cwd = session cwd，环境附加 `NEANT_PROJECT_DIR`（session 启动时的项目根）；stdin 写入 JSON 后关闭。
- http：POST JSON，非 2xx 或非 JSON 响应为非阻断错误；只有 2xx JSON body 能做决定。`headers` 中的 `$VAR` 只展开 `allowedEnvVars` 列出的变量。
- mcp_tool：经 session 已连接的 MCP 客户端调用，工具结果的文本内容按 stdout 解析；server 未连接为非阻断错误。
- prompt：单次调用 review model（`model` 覆盖时用 `resolveModel` 解析），要求输出 `{ ok: boolean, reason?: string }`，`ok:false` 视同 deny / block。agent：以只读工具集（read / glob / grep）跑一个无 transcript 的临时子 run，最终同样输出 `{ ok, reason }`。两者都复用 session 的 `streamFn`。
- 退出码：0 → stdout 首尾为 `{}` 时解析 JSON，否则为纯文本（仅 UserPromptSubmit、SessionStart 把纯文本当上下文）；2 → 阻断，原因取 JSON 的 reason，否则 stderr；其他 → 非阻断错误，若 stdout 是合法 JSON 仍按 JSON 处理。
- 通用输出：`continue: false`（优先于一切事件决定，结束 run，`stopReason` 显示给用户）、`systemMessage`（显示给用户）、`suppressOutput`（接受、无效果）。
- 默认超时：command / http / mcp_tool 600s，UserPromptSubmit 上降为 30s；prompt 30s；agent 60s；SessionEnd 全部 hook 共享 1.5s 总预算。超时取消并丢弃输出，按非阻断错误处理（fail-open）。
- async command：立即返回、不参与决定、不受超时约束；完成后的 `additionalContext` / `systemMessage` 在下一次模型调用前注入。`asyncRewake`：后台完成且 exit 2 时，若 session 空闲则以 stderr 作为一条 user 消息起新 run，若在 run 中则 steer。
- 文本上限：每条 `additionalContext`、`systemMessage`、纯文本 stdout 截断到 10,000 字符并标注截断。
- 多 hook：命中的 hook 并行执行，共享同一份输入快照。判定取最严 deny > ask > allow。多个 `updatedInput` 照 CC 以最后完成者为准（非确定）。`additionalContext` 按完成顺序全部拼接。block 原因全部拼接。
- 错误与告警：非阻断错误、超时、坏 JSON、被忽略的字段都经新事件 `hook_warning { event, hook, message }` 发出，并走 `onWarning`。

### 接入：权限判定链（`permissions/`）

- 在 `createPermissionGate` 的固定阶段最前面加 hooks 阶段（地基 C 已定顺序：hooks → 规则 → Permission Mode → 交互）。
- PreToolUse 输入：`tool_name`、`tool_input`（校验后的参数）、`tool_use_id`。输出 `hookSpecificOutput.permissionDecision`（allow / deny / ask）、`permissionDecisionReason`、`updatedInput`、`additionalContext`；exit 2 = deny。
- `updatedInput`：先按工具 schema 校验，失败则 deny（`by: "hook"`，原因说明改写非法）；通过则原地 `Object.assign` 到 pi 的 `args`（地基 C 第 4 条，附测试钉住引用行为），后续阶段都看改写后的参数。
- 合成：hook deny → 直接 deny，不再跑规则；hook ask / allow 与规则结果取最严；hook allow 等同显式 allow，跳过 Permission Mode 的 ask 与 auto-review，但越不过规则 deny / ask。
- PreToolUse 的 `additionalContext` 暂存在 toolCallId 上，于 after 阶段作为 system reminder 附在该次工具结果上（无论成功、失败还是被拒）。
- PermissionRequest：判定为 ask、进入交互阶段前触发（包括规则 ask、hook ask、Permission Mode ask、auto-review 返回 ask）。输入 `tool_name`、`tool_input`、`permission_suggestions`（交互阶段本会提供的"本 session 允许"规则）。输出 `hookSpecificOutput.decision`：
  - `behavior: "allow"`：可带 `updatedInput`（校验后改写，并重新过规则阶段；规则 deny / ask 仍生效，ask 时照常询问用户）、`updatedPermissions`。
  - `behavior: "deny"`：可带 `message`（作为拒绝原因）、`interrupt: true`（中止 run）。
  - `updatedPermissions` 只接受 `{ type: "addRules", destination: "session", behavior: "allow", rules }`（写入 session 内存规则，与"本 session 允许"同一集合）和 `{ type: "setMode", destination: "session", mode }`（调用 `setPermissionMode`）；其他条目忽略并告警。
  - exit 2 忽略。无 hook 拍板时照常进入交互阶段；无 `onPermissionAsk`（Headless）时照旧 deny。
- PermissionDenied：每次产生 `permission_denied` 事件时触发。输入 `tool_name`、`tool_input`、`tool_use_id`、`by`、`reason`，`by: "rule"` 时带 `rule`。输出 `hookSpecificOutput.retry`：仅 `by: "review"` 时生效，在拒绝结果后附一句可调整后重试的提示；其他 `by` 忽略。不推翻拒绝，exit 2 忽略。
- `permission_denied` 事件的 `by` 增加 `"hook"`；hook deny 时附带命中的 hook 标识，TUI 工具卡显示。

### 接入：after 阶段（`session/` 的 `afterToolCall`）

- PostToolUse（`isError` 为 false）输入：`tool_name`、`tool_input`、`tool_response`（工具结果的 content 与 details）、`tool_use_id`、`duration_ms`。输出：`decision: "block"` + `reason`（原因作为 system reminder 附在结果上，原结果保留）、`additionalContext`、`updatedToolOutput`（必须是合法的 content 数组，否则忽略并告警）。exit 2 = stderr 作为反馈附上。
- PostToolUseFailure（`isError` 为 true，且不是参数校验失败或权限拒绝）输入：`tool_name`、`tool_input`、`tool_use_id`、`error`、`is_interrupt`、`duration_ms`。输出仅 `additionalContext`。
- 两者都在子代理 session 内照常触发。

### 接入：Session 生命周期（`session/`）

- UserPromptSubmit：`run(prompt)` 写入 user 消息之前触发，输入 `prompt`。`decision: "block"` 或 exit 2 → 不写 transcript、不调模型，run 以新的结果 `{ stopReason: "hook_blocked", reason }` 结束（`RunResult` 增加该分支，CLI / TUI 显示原因）。`additionalContext` 与纯文本 stdout 作为 system reminder 附在该 user 消息上。由 Goal、子代理通知等 Agent Core 自己注入的 user 消息不触发。
- SessionStart：`createSession` 完成恢复 / 新建后、首个 run 的首条 user 消息之前触发一次（`source` = startup / resume / fork）；输入另带 `model`。`additionalContext` 与纯文本 stdout 暂存，附在下一条 user 消息上。不能阻断。compaction 结束后以 `source: "compact"` 再触发，结果同样附在下一条 user 消息上。
- SessionEnd：新增 `Session.dispose(reason?: "exit" | "other")`，幂等；中止进行中的 run、触发 SessionEnd（输入 `reason`，共享 1.5s 预算，输出丢弃）、关闭 MCP 连接。TUI 退出与 Headless CLI 结束时调用。
- Stop：挂在 Session 的 run 层，不挂 pi 的 `finishTurn`。触发时机是 run 即将真正结束：pi agent 循环已返回，且没有在跑的子代理与未交付的结束通知（等待子代理时不触发），最后一条 assistant 消息非中止、非错误。在 Goal 判定之前触发。输入 `stop_hook_active`、`last_assistant_message`。`decision: "block"` + `reason` 或 exit 2 → 把原因作为一条 user 消息（标记来源 `stop_hook`）再跑一轮 agent 循环，仍在同一 run 内；连续 block 计数到第 9 次时忽略该 block、发 `hook_warning` 并结束 run。计数在 run 内连续累计，用户新 run 重置。`stop_hook_active` 在本 run 已因 Stop hook 续跑过时为 true。hook 续跑不算 goal round；Stop 放行后才轮到 Goal。
- 新事件 `hook_continued { event: "Stop" | "SubagentStop", reason }`，TUI 把对应 user 消息渲染为"Stop hook 反馈"。

### 接入：子代理（`subagents/`）

- SubagentStart：子 session 每次开始一个 run 前触发（含 `send_message` 唤醒），输入 `agent_id`、`agent_type`；`additionalContext` 附在子代理该次 user 消息上。不能阻断。
- SubagentStop：子 session 的 run 即将真正结束时在子 session 内触发（同样挂 run 层），语义同 Stop（block 续跑、上限 8），输入另带 `agent_id`、`agent_type`、`agent_transcript_path`、`last_assistant_message`。父 session 在子代理真正结束后才收到结束通知。
- 子 session 的工具类 hook 输入带 `agent_id`、`agent_type`；hooks 配置为父配置加类型 frontmatter hooks（frontmatter hooks 只在子 session 内存在）。

### 接入：compaction 与交互

- PreCompact：自动 compaction 开始前触发，`trigger: "auto"`、`custom_instructions: null`。`decision: "block"` 或 exit 2 → 本次跳过 compaction（发 `hook_warning`），之后再次达到阈值时仍会尝试。
- PostCompact：`compaction_end` 之后触发，输入 `trigger`、`compact_summary`，无决定；随后触发 `SessionStart(source: "compact")`。
- Notification：地基 A 的共享交互 helper 在每次 Interaction 开始时触发（fire-and-forget，不等待结果），输入 `message`、`title`、`notification_type` = `permission_prompt` | `question` | `plan_review` | `mcp_auth`。不能阻断，输出只认 `systemMessage`。子代理发起的交互同样触发，带 `agent_id`。

### Headless CLI 与 TUI

- Headless：hooks 照常执行；hook 返回 ask 或 PermissionRequest 未拍板时 deny。`hook_warning`、`hook_continued` 进 stream-json；`systemMessage`、`stopReason` 在 text 模式下打到 stderr。结束时调用 `dispose()`。
- TUI：`hook_warning` 与 `systemMessage` 走现有告警呈现；`hook_continued` 对应的 user 消息带"Stop hook 反馈"标签；hook 拒绝的工具卡显示 `by: hook`；`stopReason` 显示在 run 结束处；退出时调用 `dispose()`。新增文案按 i18n 双语成对加入。

## Testing Decisions

- 好测试只经公开接口观察外部行为：`createSession` + `run` 的事件、`messages`、transcript、工具副作用文件、hook 脚本记录下来的 stdin。不断言 `hooks/` 内部函数、合并顺序的实现细节或时序。
- 主接缝：Agent Core e2e（`packages/agent/tests/e2e/`），照 `permission-rules.test.ts`、`compaction.test.ts`、`subagents.test.ts` 的写法：`tempDirs` 给 cwd / home，`fakeModel` 脚本化模型（prompt / agent hook 的 review 回复也排在同一脚本里），`settings.hooks` 直接传入。command hook 是临时目录里的真实 sh 脚本，用 `cat > file` 记录 stdin、`echo` 输出 JSON、`exit 2` 阻断、`sleep` 配小 `timeout` 测超时。http hook 用测试内 `Bun.serve`。mcp_tool hook 复用 `helpers/mcp-server.ts`，为它新增一个原样返回 `arguments.text` 的 `json` 工具。
- 覆盖面：每种事件至少一条 happy path 与一条阻断 / 决定路径；退出码三种语义；fail-open（超时、崩溃、坏 JSON）；hook allow 越不过规则 deny；`updatedInput` 改写后按规则判定、非法改写被拒；多 hook 各拿原始输入、判定取最严；PermissionRequest 的 allow / deny / `updatedPermissions` session 规则 / 非 session destination 被忽略；PermissionDenied 的 `retry` 仅对 review 生效；Stop 续跑与第 9 次被忽略；SubagentStop 续跑；子代理工具 hook 带 `agent_id`；PreCompact 阻止 compaction；SessionStart 四种 source；`dispose()` 触发 SessionEnd 并幂等；async hook 不阻塞、结果下一次注入。
- 不测：多个 `updatedInput` 谁最后完成谁生效（非确定）；并行时序（只用"各自拿原始输入"间接验证）；SessionEnd 1.5s 总预算只测一条小 `timeout` 用例。
- 配置：`packages/agent/tests/config/` 测 `loadSettings` 的项目层 hooks 信任闸门、去重、非法配置报错，以及子代理类型 frontmatter hooks 的加载与信任闸门（照现有 config 测试与 `subagent-types.test.ts`）。
- Headless CLI：`apps/neant-cli/tests` 加一条：hook 返回 ask 时按 deny，stream-json 含 `hook_warning`。
- TUI：不新增接缝；只为 `hook_continued` 标签与 `by: hook` 工具卡在现有组件测试里补断言。

## Out of Scope

- 其余 CC 事件：Setup、UserPromptExpansion、PostToolBatch、StopFailure、TeammateIdle、TaskCreated、TaskCompleted、InstructionsLoaded、ConfigChange、CwdChanged、DirectoryAdded、FileChanged、WorktreeCreate/Remove、Pre/PostModelSwitch、Elicitation/ElicitationResult、MessageDisplay。
- SessionStart 的 `clear` source、SessionEnd 的 `clear` 等 reason、PreCompact 的 `manual` trigger：待 Slash Command 与手动 compaction 落地。
- Notification 的 `idle_prompt`：属 frontend 空闲状态。
- 持久化的 `updatedPermissions` destination（user / project / local settings）。
- `/hooks` 管理界面、按 hash 信任单个 hook、`allowManagedHooksOnly` 等 managed 策略。
- plugin 与 skill frontmatter 声明的 hooks、`once`。
- SessionStart 的 `initialUserMessage`、`sessionTitle`、`watchPaths`、`reloadSkills`；UserPromptSubmit 的 `suppressOriginalPrompt`；`terminalSequence`；`CLAUDE_ENV_FILE` 等价物。
- powershell shell。

## Further Notes

- 依赖的能力均已落地：固定阶段权限链、权限规则与 session 内存规则、Trusted Project、子代理与 steer 通道、compaction、地基 A 交互 helper。Goal 尚未实现，Stop 与 Goal 的先后由 Goal 实现时遵守。
- 项目层 hooks 等同执行任意代码，信任闸门是唯一防线；文档需写明 Trusted Project 会放开项目 hooks。
- 改写参数依赖 pi 执行时复用同一 `args` 对象引用（地基 C 第 4 条）；pi 升级破坏时改为包一层 `execute`。
- 协议对齐 CC 的目的是用户能照 CC 文档写 hook，但字段值是 Neant 的：从 CC 迁来的脚本需要把 `Bash` 等工具名改成 `bash`，`CLAUDE_PROJECT_DIR` 改成 `NEANT_PROJECT_DIR`。
