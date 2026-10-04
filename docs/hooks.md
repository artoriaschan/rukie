# Hooks

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

`matcher` 省略、空字符串或 `*` 匹配全部。只含字母、数字、下划线、`|` 和 `,` 时按名字精确匹配，可写 `edit|write`；其余字符串使用不锚定的 JavaScript 正则，如 `mcp__github__.*`。各事件使用的匹配字段见下表；UserPromptSubmit 和 Stop 忽略 matcher。错误的正则、未知事件名和 handler 字段在 settings 加载时报告源文件和配置位置。

单个 handler 可写 `if: "bash(git push *)"`，复用 Permission Rule 的复合命令拆段和路径规范化：任一段命中就运行 hook。`if` 只用于五种工具类事件，写在其他事件上会加载告警且永不执行；非法规则加载时报错。去重键包含 `if`，不同条件的同一命令可以各运行一次。

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

PreToolUse 的退出码 2 始终拒绝，原因取 stdout JSON 的 `reason`，否则用 stderr；其他事件的退出码 2 行为见下表。退出码 0 时，stdout 首尾为 `{}` 才解析 JSON；纯文本仅 UserPromptSubmit 和 SessionStart 用作上下文。其他退出码产生非阻断告警，合法 JSON 仍可给出决定。超时、进程崩溃、坏 JSON 和被忽略的字段产生 `hook_warning` 事件并走 `onWarning`，失败放行。

PreToolUse 的 `additionalContext` 附在本次工具结果的 `<system-reminder>` 中，包括失败和权限拒绝。单条上下文、纯文本 stdout 及 `systemMessage` 限 10,000 字符，超出部分截断并标记。`systemMessage` 显示给用户；通用 `continue: false` 优先结束整个 run，`stopReason` 在 CLI stderr 或 TUI 结束处呈现。Notification 只接受显示消息，SessionEnd 丢弃输出，后台 command 不参与决定。`suppressOutput` 可提供，但不改变呈现。

## 事件与匹配

| 事件               | matcher 匹配字段    | 主要输入与行为                                                                                            |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------------- |
| PreToolUse         | `tool_name`         | 校验后的参数、调用 ID；allow / ask / deny，可改写输入。exit 2 拒绝。                                      |
| PermissionRequest  | `tool_name`         | 即将询问时触发，含 session 规则建议；可代答 allow / deny。exit 2 忽略事件决定。                           |
| PermissionDenied   | `tool_name`         | 每次拒绝触发，含 `by`、`reason`，规则拒绝含 `rule`；仅 review 拒绝接受 retry。exit 2 忽略事件决定。       |
| PostToolUse        | `tool_name`         | 成功结果和耗时；可补反馈或替换 content，block / exit 2 保留结果并附反馈。                                 |
| PostToolUseFailure | `tool_name`         | 实际执行失败、是否中断和耗时；只附加上下文。                                                              |
| UserPromptSubmit   | 无                  | 外部 `run(prompt)` 写入前；可附上下文，block / exit 2 拒绝 prompt，既不落盘也不调用模型。                 |
| SessionStart       | `source`            | startup / resume / fork / compact，另含 model；上下文附到下一条 user 消息，忽略普通 block / exit 2。      |
| Stop               | 无                  | run 真正结束前，含最后 assistant 文本、`stop_hook_active`；block / exit 2 在同 run 续跑。                 |
| SubagentStart      | `agent_type`        | 子代理每次 run、包括消息唤醒前；上下文附到该次 user 消息，忽略普通 block / exit 2。                       |
| SubagentStop       | `agent_type`        | 子代理真正结束前，另含 `agent_transcript_path`；行为同 Stop。                                             |
| PreCompact         | `trigger`           | 自动压缩前，`trigger: "auto"`、`custom_instructions: null`；block / exit 2 跳过并告警，下次阈值仍会重试。 |
| PostCompact        | `trigger`           | 压缩后，含 `compact_summary`；随后触发 SessionStart(compact)。                                            |
| SessionEnd         | `reason`            | dispose 时触发，exit / other；输出丢弃。                                                                  |
| Notification       | `notification_type` | 每次交互开始即触发，不等待结果；只显示 `systemMessage`。                                                  |

SessionStart(compact) 的上下文也会附到同一 run 的下一条 user 消息，例如 Stop 反馈或子代理结束通知。Agent Core 自己生成的续跑、通知和后台唤醒消息不触发 UserPromptSubmit。

Stop 会先等所有子代理结束及通知交付，再检查最后一条 assistant；中止、错误结果不触发。block 的原因作为 `stop_hook` 来源的 user 消息继续运行，连续最多接受 8 次，第 9 次忽略并告警；新 run 重置计数。SubagentStop 同样续跑，父 session 等子代理真正结束才收到通知。

## 执行器与超时

| type     | 配置                                     | 执行方式与默认预算                                                   |
| -------- | ---------------------------------------- | -------------------------------------------------------------------- |
| command  | `command`、可选 `args` / `shell`         | stdin JSON、stdout 协议；600 秒。                                    |
| http     | `url`、可选 `headers` / `allowedEnvVars` | POST 输入 JSON，仅 2xx JSON 对象可做决定；600 秒。                   |
| mcp_tool | `server`、`tool`、可选 `input`           | 调用该 session 已连接的 MCP 客户端，文本结果按 stdout 解析；600 秒。 |
| prompt   | `prompt`、可选 `model`                   | 单次调用 review model；30 秒。                                       |
| agent    | `prompt`、可选 `model`                   | 临时只读 agent，仅 read / glob / grep，无 transcript；60 秒。        |

`timeout` 使用秒，可为小数。command / http / mcp_tool 在 UserPromptSubmit 上默认降为 30 秒；SessionEnd 全部 hook 共享 1.5 秒预算。超时取消并丢弃输出。MCP hook 使用自己的预算，不受普通 MCP 工具的 SDK 请求期限提前截断。

HTTP headers 中的 `$VAR` 仅展开 `allowedEnvVars` 列出的环境变量，其余变量不展开。非 2xx、非 JSON 响应及网络错误产生非阻断告警，错误响应体会被取消。MCP `input` 支持 `${tool_input.x}` 和嵌套字段替换；整个值是占位符时保留 JSON 类型，嵌在文本中时转为文本。未连接的 server 产生非阻断告警。

prompt / agent 的 `$ARGUMENTS` 原样替换为输入 JSON，要求最终输出 `{ "ok": true }` 或 `{ "ok": false, "reason": "..." }`。false 在 PreToolUse 映射 deny，在 PermissionRequest 映射 deny，在支持 block 的事件映射 block；其他事件忽略决定。默认使用 review model，可用 `model` 覆盖，并复用 session 的模型调用配置。坏输出、模型错误和超时告警后放行。

去重键为 command 的 shell / command / args / if，http 的 url / if，mcp_tool 的 server / tool / input / if，prompt / agent 的 prompt / model / if。同一事件命中的完全相同 handler 只执行一次。

## 权限代答与拒绝记录

PermissionRequest 在规则、PreToolUse、Permission Mode 或 auto-review 判为 ask 时、进入交互前触发；Headless 同样触发，没有 hook 拍板仍拒绝。输出示例：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedPermissions": [
        {
          "type": "addRules",
          "destination": "session",
          "behavior": "allow",
          "rules": ["bash(git status *)"]
        }
      ]
    }
  }
}
```

allow 可以带 `updatedInput`；改写先过工具 schema，然后重新过规则。没有改写也要重验规则：显式 deny / ask 始终有效。`updatedPermissions` 只接受 session 的 allow `addRules` 或 `{ "type": "setMode", "destination": "session", "mode": "full-access" }`，与父子 session 共享内存权限配置，不写 settings；其他 destination、行为或非法值忽略并告警。

deny 的 `message` 作为原因，`interrupt: true` 停止整个 run 及后续 sibling 工具调用。多个 deny 合并原因和中断标志。PermissionRequest / PermissionDenied 的 exit 2 丢弃事件专属决定与更新，通用停止、显示消息仍有效。

PermissionDenied 不推翻拒绝。`hookSpecificOutput.retry: true` 只在 `by: "review"` 时给拒绝结果附加调整后重试的提示；rule / hook / user 拒绝忽略 retry。

## 后台 command 与通知

command 的 `async: true` 立即返回，不参与决定，也不受 hook timeout 约束；完成后的上下文和系统消息在下一次模型调用前注入。`asyncRewake: true` 同样在后台运行，exit 2 时以 stderr 唤醒：空闲 session 起新 run，活跃 run 接收 steer。等待 Stop 检查或子代理时完成的唤醒也会交付。

Notification 输入含 `message`、`title`、`notification_type`，类型为 permission_prompt / question / plan_review / mcp_auth。它不等待 hook，所有执行器都只接受 `systemMessage`；即使是 async / asyncRewake command，也不能停止、注入模型或唤醒。当前 MCP 没有授权交互入口，mcp_auth 类型供共享交互通道使用。

## 子代理类型与 session 收尾

`agents/*.md` frontmatter 可声明相同格式的 `hooks`；仅在该子代理中与父配置合并，`Stop` 自动改为 `SubagentStop`。用户目录中的类型 hooks 可加载；项目 `.neant` / `.claude` / `.agents` 中的类型 hooks 同样受 Trusted Project 限制，未信任时只丢弃 hooks，保留类型其他定义并告警。

调用 `await session.dispose(reason)` 统一收尾：中止当前 run 与后台 hooks、触发 SessionEnd、关闭 MCP，并清理子代理 session。默认 reason 为 exit，也可用 other；调用幂等。CLI finally 与 TUI 退出已接入。

前端可用 `session.subscribe(onEvent)` 观察普通及后台自动 run，返回取消订阅函数；首个订阅者也收到首次自动 run 的缓存事件。`session.running` 和 `session.interruptRun()` 提供运行状态与当前 run 的取消入口。后台启动 run 已活跃时，外部用户任务等待它真实结束后正常提交，初始 TUI / CLI 任务不会丢失；普通用户 run 仍拒绝重入。

hook_warning、hook_message、hook_continued 进入 stream-json。TUI 按所选语言显示结构化告警、hook 拒绝来源和 Stop 反馈；text CLI 将告警、系统消息和停止原因写入 stderr。

## 工具执行后的 hook

工具成功执行后触发 `PostToolUse`，输入包含 `tool_input`、`tool_response`（`content` 和 `details`）、`tool_use_id` 和真实工具执行的 `duration_ms`。`decision: "block"` 加 `reason` 或 exit 2 的原因都作为 system reminder 附在结果后，保留原结果；exit 2 优先取 stdout JSON 的 `reason`，不存在时才取 stderr。`hookSpecificOutput.additionalContext` 同样附加为 reminder。`hookSpecificOutput.updatedToolOutput` 可替换结果的 content 数组，只接受文本（`type: "text", text: string`）与图片（`type: "image", data: string, mimeType: string`）内容，非法替换会告警并保留原结果。工具的 details 与成功状态保持原值。

工具真正执行失败时触发 `PostToolUseFailure`，输入包含 `error`、`is_interrupt`、`duration_ms`，事件输出只接受 `additionalContext`，通用控制字段仍有效。参数校验失败和权限拒绝不会触发此事件。子代理同样触发这两种事件，并携带其 `agent_id` 与 `agent_type`。

取消工具后的失败 hook 仍会完成，按自身 `timeout` 或执行器默认预算收尾，使其上下文能随该工具结果写入 transcript；这可能延后取消完成。`Session.dispose()` 可随时中止此收尾 hook。
