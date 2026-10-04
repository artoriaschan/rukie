# 12: hooks

Type: grilling
Status: resolved
Blocked by: 03, 05, 11

## Question

工具调用前后（及其他生命周期事件）执行用户脚本的机制。

需定：事件集合（工具前后、run 开始 / 结束、用户提交 prompt、compaction 前 …）；脚本输入输出协议（stdin JSON / 退出码语义）；能否阻断、改写参数、向模型注入上下文；与权限规则在地基 C 链上的先后；配置位置与项目级 hooks 的信任问题（项目 hooks 等同执行任意代码）；超时与失败处理。

## Answer

2026-10-04 grilling 结论（总原则：对齐 Claude Code；CC 语义依据本地 `~/Workspaces/agent/claude-code` 源码 + 官方 hooks 文档，冲突时以文档为准。`CONTEXT.md` 新增 Hook，同步 Trusted Project、Permission Decision）：

1. **协议**：照 CC 形状——stdin JSON；exit 0 解析 stdout JSON（非 JSON 为纯文本，仅 UserPromptSubmit / SessionStart 当上下文）；exit 2 阻断（reason 取 JSON 或 stderr，JSON allow 推不翻）；其他退出码非阻断错误。`hookSpecificOutput`（`permissionDecision` / `updatedInput` / `additionalContext` …）与通用字段 `continue` / `stopReason` / `systemMessage` 照搬；`additionalContext` 等单项上限 10k 字符。
2. **事件**：PreToolUse、PermissionRequest、PermissionDenied、PostToolUse、PostToolUseFailure、UserPromptSubmit、SessionStart、Stop、SubagentStart、SubagentStop、PreCompact、PostCompact、SessionEnd、Notification。其余 CC 事件（PostToolBatch、StopFailure、FileChanged …）不做，用得上再加。
3. **Stop / SubagentStop 可 block 续跑**：`decision:"block"` + reason 或 exit 2 → 不结束 run，reason 作为 user 消息再跑一轮 agent 循环（挂 Session run 层：子代理全部结束、run 真正要结束时才触发；不挂 pi `finishTurn`，否则等待子代理时会反复触发）；输入带 `stop_hook_active`；连续 block 上限 8 次，超出忽略并告警。Stop hook 先于 Goal 判定；hook 续跑不算 goal round。SubagentStop 同理作用于子代理，父 session 等子代理真结束才收到通知。
4. **配置与信任**：用户层 / 项目层 settings `hooks.<Event>[]{matcher, hooks[]}`，合并执行；项目层 hooks 仅 Trusted Project 加载，否则忽略并告警。子代理类型 `agents/*.md` frontmatter 可声明 hooks，仅该子代理运行时生效，项目层同受信任闸门；frontmatter 中 `Stop` 转为 `SubagentStop`。同一 hook 跨层去重（command+`if` 等为键）。
5. **matcher / `if`**：对齐 CC。matcher 仅含字母数字 `_` `|` `,` 时精确名或列表，否则不锚定 JS 正则；`*`/空/省略匹配全部。非工具事件匹配各自字段（SessionStart `source`、Pre/PostCompact `trigger`、Notification `notification_type`、SessionEnd `reason`、Subagent* `agent_type`）。handler 级 `if` 为一条 Permission Rule（`bash(git *)`），仅工具类事件生效。
6. **类型**：command（含 `async` / `asyncRewake`）/ http / mcp_tool / prompt / agent；prompt、agent 默认用 auto-review 的 review model，`model` 可覆盖。
7. **超时与失败**：默认值照 CC（command/http/mcp_tool 600s，UserPromptSubmit 降 30s；prompt 30s；agent 60s；SessionEnd 总预算 1.5s）；可按 hook 覆盖。超时 fail-open（PreToolUse 超时不阻断）；错误发 warning 事件。
8. **多 hook**：命中的 hooks 并行，各自拿原始输入，互不串联；判定取最严；多个 `updatedInput` 照 CC 谁最后完成谁生效（非确定，spec 注明，测试只覆盖单 hook 改写）；最终参数按地基 C 交规则阶段再判；`additionalContext` 全部注入。
9. **PermissionRequest**：判定为 ask、进入交互阶段前触发，Headless 也触发（无 hook 拍板仍 deny）。`decision.behavior` allow/deny、`updatedInput`（再过规则）、`message`、`interrupt` 照 CC；`updatedPermissions` 仅支持 `destination:"session"` 的 `addRules`（成 session 内存规则）与 `setMode`，其余忽略并告警。规则 deny 仍胜 hook allow。
10. **PermissionDenied**：所有拒绝（`by` = rule/hook/user/review）都触发，输入带 `by`、`reason`、规则拒绝时带 `rule`；matcher 匹配工具名。输出仅 `retry:true`，只对 `by:"review"` 生效（给拒绝结果附"可调整后重试"），不推翻拒绝；exit 2 忽略。
11. **Post 阶段**：PostToolUse 可 `decision:"block"`+reason（附在结果旁）、`additionalContext`、`updatedToolOutput`（须符合工具输出形状，否则忽略）；PostToolUseFailure 仅 `additionalContext`；校验错误与权限拒绝不触发 Failure。落在地基 C 的 after 阶段。
12. **生命周期事件**：UserPromptSubmit 可 block（reason 给用户）、注入 `additionalContext`，不可改写 prompt。SessionStart `source` = startup/resume/compact/fork（`clear` 待 Slash Command），可注入上下文、不能阻断。PreCompact 可阻止 compaction，`trigger` = auto/manual（manual 待手动 compaction）；compaction 后触发 PostCompact，再以 `source:"compact"` 触发 SessionStart。SessionEnd 在 `Session.dispose` 触发，`reason` = exit/other。Notification 在每次 Interaction 开始时由 Agent Core 触发，`notification_type` = permission_prompt / question / plan_review / mcp_auth，不能阻断；`idle_prompt` 不做。SubagentStart 可向子代理注入 `additionalContext`。
13. **命名本地化**：字段照 CC snake_case；`tool_name`、matcher、`if` 用 Neant 工具名与 Permission Rule 语法；`permission_mode` 取 ask/auto-review/full-access；`transcript_path` 指 Neant JSONL；环境变量 `NEANT_PROJECT_DIR`，不提供 `CLAUDE_*`。
14. **子代理**：子代理内工具调用照常触发工具类 hooks，输入带 `agent_id` / `agent_type`（与地基 C 按引用共享配置一致）。
15. **Headless**：hooks 照常执行；hook 返回 ask 按 deny。
