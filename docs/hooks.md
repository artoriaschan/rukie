# PreToolUse command hooks

在 `~/.neant/settings.json` 中配置用户 hooks，在项目的 `.neant/settings.json` 中配置项目 hooks：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [{ "type": "command", "command": "sh .neant/check-command.sh", "timeout": 10 }]
      }
    ]
  }
}
```

用户层始终加载，项目层只在用户 settings 的 `trustedProjects` 包含该项目的绝对目录时加载。**信任项目会允许项目 hooks 执行任意代码**，同时放开项目 MCP 配置和项目 allow 规则。项目自己声明 `trustedProjects` 无效；未被信任的项目 hooks 会被丢弃并告警。用户层在前、项目层在后合并，相同 handler 在同一事件只执行一次。

`matcher` 省略、空字符串或 `*` 匹配所有工具。只含字母、数字、下划线、`|` 和 `,` 时按工具名精确匹配，可写 `edit|write`；其余字符串使用不锚定的 JavaScript 正则，如 `mcp__github__.*`。错误的正则、未知事件名和 handler 字段在 settings 加载时报告源文件和配置位置。

command 默认经 `sh -c` 执行；`shell: "bash"` 改用 Bash。提供 `args` 时直接执行 `command` 和参数列表，避免 shell 展开。工作目录为 session 的 cwd，环境包含 `NEANT_PROJECT_DIR`。脚本从 stdin 读取 JSON，输入后 stdin 关闭：

```json
{
  "session_id": "...",
  "transcript_path": "/absolute/path/to/session.jsonl",
  "cwd": "/project",
  "permission_mode": "ask",
  "hook_event_name": "PreToolUse",
  "tool_name": "bash",
  "tool_input": { "command": "git status" },
  "tool_use_id": "..."
}
```

子代理工具调用另有 `agent_id` 和 `agent_type`。工具名使用 Neant 命名：`bash`、`edit`、`skill`、`mcp__<server>__<tool>`。

脚本退出码 0 时解析 stdout JSON：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Protected project configuration",
    "additionalContext": "Use the development configuration instead."
  }
}
```

`deny` 阻止工具执行并把原因交回模型；`ask` 在 full-access 下仍需询问，Headless CLI 会拒绝；`allow` 跳过 Permission Mode 的询问和 auto-review，但不能越过权限规则的 deny 或 ask。`updatedInput` 可替换参数，先按工具 schema 校验，再以改写后的参数检查规则；非法改写被拒绝。多个 hook 并行读取原始输入，判定取最严：deny > ask > allow，所有拒绝原因与附加上下文合并。

退出码 2 始终阻断，原因取 stdout JSON 的 `reason`，否则用 stderr；其他退出码产生非阻断告警，合法 JSON 仍可给出决定。超时、进程崩溃和坏 JSON 产生 `hook_warning` 事件并走 `onWarning`，工具调用照常进行。command 默认超时 600 秒，`timeout` 使用秒，可为小数；超时会取消脚本并丢弃输出。

`additionalContext` 附在本次工具结果的 `<system-reminder>` 中，包括失败和权限拒绝。单条上下文及 `systemMessage` 限 10,000 字符，超出部分截断并标记。`systemMessage` 显示给用户；`continue: false` 优先结束整个 run，`stopReason` 在 CLI stderr 或 TUI 结束处呈现。`suppressOutput` 可提供，但不改变呈现。

目前执行入口为 PreToolUse command；settings schema 已定义后续事件与其他 handler 类型，后续票将接入它们。

## 工具执行后的 hook

工具成功执行后触发 `PostToolUse`，输入包含 `tool_input`、`tool_response`（`content` 和 `details`）、`tool_use_id` 和真实工具执行的 `duration_ms`。`decision: "block"` 加 `reason` 或 exit 2 的 stderr 都作为 system reminder 附在结果后，保留原结果；`hookSpecificOutput.additionalContext` 同样附加为 reminder。`hookSpecificOutput.updatedToolOutput` 可替换结果的 content 数组，只接受文本（`type: "text", text: string`）与图片（`type: "image", data: string, mimeType: string`）内容，非法替换会告警并保留原结果。工具的 details 与成功状态保持原值。

工具真正执行失败时触发 `PostToolUseFailure`，输入包含 `error`、`is_interrupt`、`duration_ms`，事件输出只接受 `additionalContext`，通用控制字段仍有效。参数校验失败和权限拒绝不会触发此事件。子代理同样触发这两种事件，并携带其 `agent_id` 与 `agent_type`。

取消工具后的失败 hook 仍会完成，按自身 `timeout`（默认 600 秒）收尾，使其上下文能随该工具结果写入 transcript；这可能延后取消完成。`Session.dispose()` 可随时中止此收尾 hook。
