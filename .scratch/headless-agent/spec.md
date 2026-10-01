Status: ready-for-agent

# Spec: Headless Agent（Agent Core + CLI）

## Problem Statement

我要做一个桌面端 coding agent，但桌面 UI、server、打包这些都依赖一个能稳定工作的 agent 内核。现在仓库里还没有代码。我需要先有一个 headless 的 agent：在终端里给它一个 prompt，它就能在当前项目里读代码、搜索、改文件、执行命令。它要能接上我已有的 MCP server 和 skills，能读取项目的 AGENTS.md，还能在中断后续上之前的对话。这些能力以后会原样交给桌面端使用，不想到时候再重写一遍。

## Solution

做一个 Bun monorepo。核心是 Agent Core（`@neant/agent`），建在 pi-agent-core 的 harness 之上；前端是 `neant` CLI（`@neant/cli`）；跨运行时共享的类型和 schema 放在 `@neant/shared`。

用户运行 `neant -p "<prompt>"`，agent 在当前目录下完成一个 Run，结果以纯文本或 JSONL 事件流（`stream-json`）输出。具体行为：

- Session 自动保存为 JSONL，可以用 `--resume <id>` 接着聊。
- 模型通过 System Prompt 和 System Reminder 拿到身份、环境、Project Instructions 和可用 skills 等信息。
- 内置工具默认只开放只读的那几个，写文件、执行命令和 MCP 工具需要显式授权。
- 上下文快满时自动做 compaction。

## User Stories

### 运行与输出

1. 作为开发者，我想运行 `neant -p "<prompt>"` 让 agent 在当前目录处理一个任务，这样不用打开 GUI 就能用 agent。
2. 作为开发者，我想默认得到纯文本输出（最终的 assistant 回复），这样在终端里能直接读。
3. 作为脚本作者，我想用 `--output-format stream-json` 拿到 JSONL 事件流，这样可以用程序消费 agent 的执行过程。
4. 作为脚本作者，我想每个事件都带 `sessionId`，这样能把事件和 session 对应起来。
5. 作为脚本作者，我想在流开头收到 `session_start` 事件（包含 sessionId、model、cwd、可用工具），这样能知道本次运行的配置。
6. 作为脚本作者，我想在流末尾收到 `result` 事件（包含最终文本、是否成功、token 用量、耗时），这样不必自己从事件里拼结果。
7. 作为脚本作者，我想在成功时得到退出码 0、失败时得到非 0，这样能在 shell 里判断结果。
8. 作为开发者，我想用 Ctrl-C 中断正在进行的 Run，并且已经产生的消息不会丢，这样中断后还能 resume。
9. 作为开发者，我想通过 stdin 传入 prompt（不写 `-p` 参数时从管道读取），这样能把其他命令的输出喂给 agent。

### 模型与配置

10. 作为开发者，我想在 `~/.neant/settings.json` 里设置默认的 `model`（格式为 `provider/id`），这样不用每次都传参数。
11. 作为开发者，我想用 `--model provider/id` 临时覆盖默认模型，这样能方便地对比不同模型。
12. 作为开发者，我想直接使用 pi-ai 内置的 provider，并从标准环境变量（如 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`）读取 key，这样零配置就能用。
13. 作为开发者，我想在 settings 里定义自定义 provider（api 类型可以是 Chat Completions、Responses 或 Anthropic Messages，并配置 baseUrl、存放 key 的环境变量名和模型列表），这样能接本地模型或代理。
14. 作为开发者，我想配置文件里只写环境变量名、不写明文 key，这样配置文件可以放心同步。
15. 作为开发者，我想设置 `thinking` 等级（也可以用 CLI 参数覆盖），这样能控制推理强度。
16. 作为开发者，我想在项目里放一个 `.neant/settings.json` 覆盖 `model` 和 `allowTools`，这样不同项目可以用不同配置。
17. 作为安全敏感的用户，我希望项目级 settings **不能**定义 provider，这样克隆一个恶意仓库也不会把我的请求和 key 发到别处。
18. 作为开发者，我想在配置文件不合法时看到明确的错误（指出哪个文件、哪个字段），这样能快速修好。
19. 作为开发者，我想在模型或 key 缺失时看到明确的错误，并以非 0 退出码退出，这样不会卡住或静默失败。

### Session 与持久化

20. 作为开发者，我想每次 Run 都自动保存为一个 Session，这样事后能回看。
21. 作为开发者，我想用 `--resume <sessionId>` 在已有 Session 上继续提问，这样能多轮协作。
22. 作为开发者，我想 resume 之后模型看到的上下文和当时完全一致（包括之前注入的 System Reminder），这样它的行为是连贯的。
23. 作为开发者，我想 Session 文件按项目路径分目录存放在 `~/.neant/sessions/` 下，并使用 pi 的 JSONL 格式，这样能直接用工具查看和处理。
24. 作为开发者，我想 resume 一个不存在的 id 时得到明确报错，这样不会误开一个新 Session。
25. 作为未来的桌面端，我需要 Session Store 是一个可以替换的接口，这样以后能换成 SQLite 实现，而不用改动 Agent Core。

### System Prompt 与 System Reminder

26. 作为开发者，我希望 agent 有一份固定的 System Prompt，定义它作为 coding agent 的身份、工具使用规范和回复风格，这样行为稳定，而且能跨项目命中 prompt cache。
27. 作为开发者，我希望 Session 的第一条 user 消息上附带环境信息 reminder（cwd、平台、日期、git 分支和 status），这样模型了解它所处的环境。
28. 作为开发者，我希望项目根目录下的 `AGENTS.md`（没有的话用 `CLAUDE.md`）作为 Project Instructions 注入，这样模型会遵守项目约定。
29. 作为开发者，我希望用户级的 `~/.neant/AGENTS.md` 也会注入，这样我的个人偏好对所有项目都生效。
30. 作为开发者，我希望可用 skills 的名称和描述列表以 reminder 形式注入，这样模型知道有哪些 skill 可以加载。
31. 作为开发者，我希望已连接的 MCP server 提供的 instructions 以 reminder 形式注入，这样模型知道怎么用这些工具。
32. 作为开发者，我希望 resume 时如果日期已经变了，自动补发一条日期 reminder，这样模型不会用错日期。
33. 作为开发者，我希望 resume 时如果 skills 列表或 MCP 工具有变化，补发一条增量 reminder，这样模型知道能力变了。
34. 作为开发者，我希望注入过的 reminder 都写进 Transcript，以后不再修改，这样 prompt cache 前缀稳定，resume 也能如实还原。
35. 作为终端用户，我希望 text 输出里看不到 reminder 内容，这样输出干净；但 stream-json 里有 `reminder_injected` 事件，方便调试。

### 工具

36. 作为开发者，我希望 agent 能用 `read` 读取文件（支持行范围），这样它能理解代码。
37. 作为开发者，我希望 agent 能用 `glob` 按模式找文件，并且遵守 `.gitignore`，这样搜索不会被 `node_modules` 之类的目录淹没。
38. 作为开发者，我希望 agent 能用 `grep` 做正则搜索（底层调用 `rg`），这样大仓库里搜索也很快。
39. 作为开发者，我希望系统里没装 `rg` 时，`grep` 工具返回带安装提示的错误，而不是让整个进程崩溃。
40. 作为开发者，我希望 agent 能用 `write` 和 `edit` 修改文件，这样它能真正完成编码任务。
41. 作为开发者，我希望 agent 能用 `bash` 执行命令，有超时控制，而且 Ctrl-C 会终止子进程，这样它能跑测试和构建。
42. 作为开发者，我希望工具抛出的异常会作为 `isError` 结果返回给模型，而不是中断 Run，这样模型可以自己修正。

### 权限

43. 作为谨慎的用户，我希望默认只放开 `read`、`glob`、`grep`、`skill` 这几个工具，这样在陌生仓库里运行也不会被改文件或执行命令。
44. 作为开发者，我想用 `--allow-tools`（支持 glob 模式，如 `bash`、`mcp__github__*`）放开指定工具，这样能精确授权。
45. 作为开发者，我想把 `allowTools` 写进 settings，这样常用的授权不用每次都传。
46. 作为开发者，我想用 `--yolo` 放开所有工具，这样在可信环境里可以完全自主运行。
47. 作为开发者，我希望没有授权的工具调用以 `isError` 的形式告诉模型"该工具未获授权"，并在 stream-json 里发出 `permission_denied` 事件，这样模型可以换个做法，我也能知道发生了什么。
48. 作为未来的桌面端，我需要权限判定是一个单独的函数，返回 `allow`、`deny` 或 `ask`，这样以后能把 `ask` 接到 UI 弹窗上；headless 模式下 `ask` 按 `deny` 处理。

### Skills

49. 作为开发者，我希望 agent 能发现符合 Agent Skills 规范的 skill（一个目录加 `SKILL.md` 和 frontmatter），这样能复用现有的 skill 生态。
50. 作为开发者，我希望 skill 的发现路径覆盖用户级和项目级的 `.neant/skills`、`.claude/skills`、`.agents/skills`，这样已有的 skill 不用搬家。
51. 作为开发者，我希望模型通过 `skill` 工具按名称加载 skill 正文，这样上下文里只在需要时才出现完整内容。
52. 作为开发者，我希望在 prompt 开头写 `/name` 就能主动展开对应的 skill（Skill Invocation），并且我原来写的话保持不变，这样能直接指定流程。
53. 作为开发者，我希望 `/name` 找不到对应的 skill 时，prompt 按普通文本原样发送，这样不会误伤以 `/` 开头的路径。
54. 作为开发者，我希望格式有问题的 skill 被跳过并给出警告，而不是让启动失败。

### MCP

55. 作为开发者，我希望从 `~/.neant/mcp.json` 加载用户级的 MCP server（格式兼容 `.mcp.json` 的 `mcpServers`），这样能复用现有配置。
56. 作为开发者，我希望同时支持 stdio 和 Streamable HTTP 两种传输方式（HTTP 支持配置 headers），这样本地和远程的 server 都能接。
57. 作为开发者，我希望 MCP 工具以 `mcp__<server>__<tool>` 的名字出现，这样不会和内置工具冲突，也方便按 server 授权。
58. 作为安全敏感的用户，我希望项目里的 `.mcp.json` 默认不加载，只有加了 `--trust-project-mcp` 或该项目在用户级信任列表里（Trusted Project）时才加载，这样克隆仓库不会自动执行其中的命令。
59. 作为开发者，我希望某个 MCP server 启动失败时给出警告并继续运行（stream-json 里有对应事件），这样一个坏掉的 server 不会拖垮整个 agent。
60. 作为开发者，我希望 Run 结束时 MCP 的子进程都被正确关闭，这样不会留下孤儿进程。
61. 作为开发者，我希望 MCP 工具默认是禁用状态，需要授权才能用，因为它们的副作用无法预知。

### Compaction

62. 作为开发者，我希望上下文用量超过模型上下文窗口的约 80% 时自动做 compaction，这样长任务不会因为上下文超限而失败。
63. 作为开发者，我希望 compaction 生成的摘要作为一条 entry 写进 Transcript，原始消息保留在文件里，这样历史可以追溯。
64. 作为脚本作者，我希望 compaction 发生时在 stream-json 里收到对应事件，这样能知道上下文被压缩过。

### 开发体验

65. 作为项目维护者，我希望第一个代码 commit 就配好 oxlint、oxfmt、husky、lint-staged、commitlint、knip 和 `tsc -b`，这样代码质量从一开始就有保障。
66. 作为项目维护者，我希望 `@neant/shared` 不能引用 `Bun.*`、`node:*` 或 DOM API，并由 lint 强制检查，这样以后渲染进程也能放心引用它。
67. 作为项目维护者，我希望用一条命令就能在所有包上跑完测试、类型检查和 lint，这样提交前容易验证。

## Implementation Decisions

### 仓库与包

- Bun workspaces，目录分为 `apps/*` 和 `packages/*`。本 spec 包含三个包：`@neant/shared`、`@neant/agent`、`@neant/cli`。server 和 desktop 不在本 spec 范围内。
- 内部包不构建：`exports` 直接指向源码入口，用 `workspace:*` 互相引用。
- 每个 CONTEXT.md 里的概念对应一个目录，目录对外只通过各自的入口文件导出；跨概念引用只能经过这个入口。
- TypeScript 使用公共的 base 配置，开启 strict，`moduleResolution` 为 `bundler`；用 `tsc -b` 对所有包做类型检查。
- 依赖版本按项目定下的技术栈锁定：pi-ai、pi-agent-core、pi-mcp 都用 0.99.2，TypeScript 用 6.0.3。typebox 的版本与 pi 依赖的一致（0.99.2 依赖 1.3.27），精确锁定；以后升级 pi 时一起调整，保证依赖树里只有一份 typebox。

### 复用 pi（ADR-0002）

- 直接复用：`Agent` loop 和它的 hooks、`loadSkills`、内置的 read/write/edit/bash 工具、`compact` 和 `estimateTokens`、session repo 接口和 `JsonlSessionRepo`，以及 `pi-mcp` 的连接和工具适配。
- 自研：System Prompt 的内容和组装、System Reminder、权限判定、grep 和 glob 工具、`skill` 工具、Skill Invocation、配置加载和信任判断、CLI。
- 不依赖 `pi-coding-agent`。

### `@neant/shared`

- 只放与运行时无关的内容，唯一允许的依赖是 typebox。
- 现在放两样东西：
  - **Agent 事件类型**：透传 pi 的 `AgentEvent`，外层加上 `sessionId`，再补充几种自定义事件：`session_start`、`reminder_injected`、`permission_denied`、`mcp_server_error`、`compaction`、`result`。
  - **Settings 的 typebox schema**：包括 `model`、`thinking`、`providers[]`（包含 `id`、`api`、`baseUrl`、`apiKeyEnv`、`models[]`）、`allowTools[]`、`trustedProjects[]`。

### Agent Core（`@neant/agent`）对外接口

- 只有一个入口：用 `createSession(options)` 创建或恢复一个 Session，然后调用 `session.run(prompt, { signal })`，它返回事件流，结束时给出 result。
- options 包括：`cwd`、`homeDir`（默认 `~`，测试时可以注入）、合并后的 settings、可选的 `streamFn`（默认使用 pi-ai 的 `streamSimple`，测试时注入假实现）、`store`（Session Store 实现）、`resumeId`、额外放开的工具（对应 CLI 的 `--allow-tools`）、`yolo`、`trustProjectMcp`。
- Session 负责：组装 pi `Agent`（system prompt、工具集、hooks），加载 skills 并连接 MCP，在 hooks 里注入 reminder 和做权限拦截，把消息写入 store，在 Run 结束时清理 MCP 连接。

### 各概念的职责

- **config**：读取用户级和项目级的 settings 并按 schema 校验；合并规则是项目级只能覆盖 `model` 和 `allowTools`，如果出现 `providers` 字段则忽略并给出警告；根据 settings 注册内置 provider 和自定义 provider；判断当前项目是否是 Trusted Project。
- **prompt**：维护一份静态的 System Prompt 文本（内容是身份、工具使用规范和风格），构建时内联进代码。System Prompt 里不放任何环境信息或项目信息。
- **reminders**：
  - 定义一种自定义消息类型，在 `convertToLlm` 时转成包着 `<system-reminder>` 的 user 内容。
  - 来源有：环境信息、Project Instructions（用户级和项目级）、skills 列表、MCP instructions、日期。
  - 首次 Run 时，在第一条 user 消息之前注入全部内容。之后的 Run（resume）里，先和 Transcript 中最近一次注入的内容比较，只补发有变化的部分（日期、skills 列表、MCP 工具列表）。
  - 注入的内容写进 Transcript，以后不再修改。
- **permissions**：一个纯判定函数，根据工具名、默认的只读集合、settings 和 CLI 放开的模式（glob 匹配）以及 yolo 开关，返回 `allow`、`deny` 或 `ask`。它挂在 `beforeToolCall` 上；判定不是 allow 时阻止这次调用，向模型返回"该工具未获授权"的错误，并发出 `permission_denied` 事件。
- **tools**：注册 pi 内置的 read、write、edit、bash；自己实现 glob（基于 `Bun.Glob`，遵守 `.gitignore`）和 grep（调用 `rg`，找不到时返回错误）；再加上 `skill` 工具（按名称返回 skill 正文）。
- **skills**：按用户级和项目级的 `.neant`、`.claude`、`.agents` 下的 skills 目录调用 `loadSkills` 做发现，名称冲突时项目级优先；解析 prompt 开头的 `/name` 做 Skill Invocation，展开的正文作为 reminder 附在这条 user 消息上。
- **mcp**：用 `pi-mcp` 连接用户级的 `mcp.json`，以及（仅限 Trusted Project 或带 trust 参数时）项目的 `.mcp.json`；把 MCP 工具适配成 `mcp__<server>__<tool>`；单个 server 失败时发出 `mcp_server_error` 事件并继续运行；收集各 server 的 instructions 交给 reminders；Session 结束时关闭所有连接。
- **store**：使用 pi 的 session repo 接口，headless 模式下用 `JsonlSessionRepo` 的原生 v4 格式，路径为 `~/.neant/sessions/<项目路径 slug>/<时间戳>_<id>.jsonl`（slug 和文件名由 pi 生成）。现在只用线性结构，不提供分支操作。SQLite 实现不在本 spec 范围内（见 ADR-0003）。
- **compaction**：在每个 turn 开始前估算 token 用量，超过上下文窗口约 80% 时调用 pi 的 `compact`；生成的摘要作为一条 entry 写入，原始消息保留；发出 `compaction` 事件。

### CLI（`@neant/cli`）

- 参数：`-p/--prompt`（不写时从 stdin 读取）、`--output-format text|stream-json`（默认 text）、`--resume <id>`、`--model`、`--thinking`、`--allow-tools <pattern...>`、`--yolo`、`--trust-project-mcp`。
- text 模式下只输出最终的 assistant 文本，警告写到 stderr；stream-json 模式下每行一个事件写到 stdout。
- 退出码：成功为 0；Run 失败（模型报错、配置错误）为 1；参数错误为 2；被中断为 130。
- SIGINT 时中止 Run，等已经产生的消息都写入 store、MCP 连接都关闭之后再退出。
- 分发形式（`bun build --compile`）不在本 spec 范围内，现在通过 bun 直接运行。

## Testing Decisions

- 好的测试只验证外部可观察的行为：发出的事件、模型收到的上下文（假 `streamFn` 记录下来的请求）、Transcript 文件的内容、文件系统的副作用、进程的输出和退出码。不对内部函数做单元测试，也不 mock 模块。
- 测试工具按运行时选择（ADR-0004）：这三个包都用 `bun:test`。
- 测试文件放在各包根目录的 `tests/` 下，结构与 `src/` 对应；跨概念的测试放在 `tests/e2e/`，测试辅助代码放在 `tests/helpers/`。
- **Seam 1：Agent Core 的公开接口**（覆盖面最大，大部分测试都在这里）
  - 在模型这一侧注入一个假 `streamFn`，它按脚本依次返回 assistant 文本或工具调用，并记录每次收到的上下文。这是唯一的 test double。
  - `cwd` 和 `homeDir` 都指向临时目录，在里面准备 AGENTS.md、skills、settings 和 `.mcp.json`。
  - 覆盖：reminder 的首次注入和增量补发（还要验证 resume 后上下文前缀和之前完全一致）、权限的放开和拒绝（包括 glob 模式匹配和 yolo）、skill 工具和 `/name` 展开、grep 和 glob 的结果、JSONL 写入和 resume、项目级 settings 不能定义 provider、MCP 的信任判断和失败降级、compaction 的触发和写入、abort 之后消息不丢失。
  - MCP 用 `tests/helpers` 里一个真实的 stdio MCP server 脚本，测试时作为子进程启动，不用 mock。
- **Seam 2：CLI 进程**（只写少量测试）
  - 真正启动 `neant` 子进程。模型端用 `Bun.serve` 起一个假的 OpenAI 兼容服务（Chat Completions），通过临时 home 目录里 settings 的自定义 provider 指向它。
  - 覆盖：text 输出、stream-json 的事件顺序（以 `session_start` 开头、以 `result` 结尾）、`--resume`、缺少模型或 key 时的报错和退出码、参数错误时退出码为 2。
- `@neant/shared` 不单独测试，通过上面两个 seam 间接覆盖。
- 仓库里还没有测试，这个 spec 的测试会成为后续测试的参考范例。

## Out of Scope

- Server（Hono/WS）、Electron 桌面端、渲染进程 UI、打包、自动更新、koffi 原生依赖。
- SQLite 版的 Session Store（只保留接口，见 ADR-0003）。
- 交互式 REPL 和 TUI。
- 权限的规则引擎和交互式的 `ask` 确认。
- MCP 的 resources、prompts、OAuth，以及 SSE 传输。
- todo 工具、子 agent、web fetch 和其他内置工具。
- 文件被外部修改的检测、todo 状态这类 reminder 来源。
- Session 分支、fork 和 rewind（JSONL 格式已经支持树结构，但现在不用）。
- 手动触发 compaction 的 CLI 参数。
- CLI 编译成单文件可执行程序和对外分发。
- 国际化。

## Further Notes

- 术语以 `CONTEXT.md` 为准，架构决策见 `docs/adr/0001`–`0004`，目录约定见 `CLAUDE.md` 的 Repo layout 一节。
- pi-agent-core 0.99.2 已经核实过的 API：`Agent`、`transformContext`、`convertToLlm`、`beforeToolCall`、`afterToolCall`、`prepareRequest`；自定义消息类型通过 `CustomAgentMessages` 的声明合并来定义；system prompt 以 system 消息的形式存在 transcript 里。具体用法实现时以 tarball 里的 `.d.ts` 为准。
- typebox 的版本跟 pi 走，不按技术栈清单里写的 1.3.34。原因是如果出现两份 typebox，pi 工具的 schema 和我们自己的 schema 类型会对不上。安装后用 `bun pm ls` 确认依赖树里只有一份。
- `@hono/bun` 是 server 阶段的依赖，本 spec 不引入。
