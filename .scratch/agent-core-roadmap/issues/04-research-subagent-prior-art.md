# 04: 子代理参考实现调研

Type: research
Status: resolved
Blocked by: None

## Question

Claude Code（Task / Agent 工具，公开文档）、deepseek-harness 与 dsh-TUI（本地源码）如何实现子代理？

需要的事实：工具 schema；上下文隔离（子代理看到什么系统提示、工具集、历史）；结果如何返回父代理（全文 / 摘要）；并发与取消；权限继承；transcript 存储位置；frontend 如何呈现子代理进度；token 与费用计量归属；子代理能否再派子代理。产出带引用的对比表。

## Answer

dsh-TUI 的子代理运行时就是 deepseek-harness 的 `@deepseek-ai/dsh-subagent` / `dsh-tool-subagent`（dsh-TUI `package.json:272`），dsh-TUI 只做配置、事件投影和 TUI 呈现。

| 维度        | Claude Code [SA]=code.claude.com/docs/en/sub-agents                                                                        | deepseek-harness                                                                                                                                                             | dsh-TUI                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 工具 / 参数 | `Agent`（原 `Task`）：`description, prompt, subagent_type?, model?, run_in_background?, isolation?` [agent-sdk/typescript] | `subagent`（spawn）/`subagent_fork`：`description, prompt`，以及可选的 `provider/model/run_in_background`（`packages/subagent/tool-subagent/src/index.ts:389-428`）          | 同 harness（`presets/liangshen/agent.cordis.yml:316-381`）                                    |
| 上下文      | 定义正文作系统提示加 CLAUDE.md；无父历史，只有 prompt；fork 继承全部历史 [SA]                                              | 复用父 preset 的提示和工具，追加委派说明；spawn 无历史，fork 种入父代理已完成的 turn（`subagent/src/child-agent.ts:172-218`，`subagent-fork-in-process/src/index.ts:48-55`） | 同 harness                                                                                    |
| 回传        | 仅最终消息 [tools-reference]                                                                                               | 最后一条非空 assistant 文本（`subagent/src/assistant-output.ts:1-59`）；continuable 结束时注入 user 消息                                                                     | UI 用 `lastAssistantMessage` 作摘要                                                           |
| 并发 / 取消 | 后台并发上限 20；`TaskStop`、`/tasks` 中按 x [SA]                                                                          | `isConcurrencySafe`；continuable 上限 8；父 abort 级联到子代理（`subagent-in-process-driver/src/index.ts:168-176`）                                                          | 详情页按 X 中断                                                                               |
| 权限        | 继承父规则，子代理的 ask 冒泡给用户 [tools-reference]                                                                      | 审批策略固定 `'never'`，ask 自动拒绝（`subagent/src/child-agent.ts:229-256`）                                                                                                | 同 harness                                                                                    |
| transcript  | `~/.claude/projects/{p}/{sid}/subagents/agent-{id}.jsonl` [SA]                                                             | 独立 Session JSONL，header 记 `parentSession`、`delegationDepth`（`child-agent.ts:139-157`）                                                                                 | `~/.dsh/sessions`（`cordis.patch.yml:237-239`）                                               |
| 前端        | 子代理面板树；`parent_tool_use_id`、`task_*` 消息；`SubagentStart/Stop` hook [SA][hooks]                                   | `subagent/start\|end` 事件；Web UI 有后代树和侧栏子会话                                                                                                                      | 3 行实时卡片，完成后折叠；`Ctrl+A` 仪表盘（`src/components/Chat/SubagentMessage.tsx:51-154`） |
| 计量        | 计入 `total_cost_usd`，`/usage` 按子代理归因 [costs]                                                                       | 每个子会话独立 tokenUsage，不汇总                                                                                                                                            | 主代理与子代理 ¥ 分开显示（`src/screens/StatusLine.tsx:370-379`）                             |
| 嵌套        | 默认最多 3 层，fork 不能再 fork [SA]                                                                                       | 默认 `maxDepth=1`（`subagent/src/index.ts:195-202`）                                                                                                                         | patch 取消 TUI 原有的深度 1 上限，交给 preset                                                 |
| 定义        | `.claude/agents/*.md` frontmatter，内置 Explore/Plan/general-purpose                                                       | 无具名类型，用 provider 加 Cordis 工具实例                                                                                                                                   | 同 harness                                                                                    |

共同点：三者都只回传最终文本，子 transcript 都是带 parent 链接的独立 JSONL，前端进度都走事件。分歧点：权限（冒泡给用户 vs 自动拒绝）、嵌套深度默认值（3 vs 1）、agent 定义方式（具名 markdown vs provider 配置）。

详见 branch research/subagent-prior-art:docs/research/subagent-prior-art.md
