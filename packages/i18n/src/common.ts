import type { UserVisibleErrorCode } from "@neant/shared";

const modelExample = `{
  "model": "local/my-model",
  "providers": [
    {
      "id": "local",
      "api": "openai-completions",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKeyEnv": "LOCAL_API_KEY",
      "models": [
        {
          "id": "my-model"
        }
      ]
    }
  ]
}`;

const zh = {
  "error.goal-tool-human-required": "操作 Goal 需要当前 Run 的直接人类输入。",
  "error.goal-tool-completion-authority": "确认 Goal 完成或阻塞需要直接人类输入或当前 Goal 轮次。",
  "error.goal-tool-invalid-argument": "{{field}} 仅可用于 {{action}} 操作。",
  "error.goal-tool-required-argument": "{{action}} 操作必须提供非空 {{field}}。",
  "error.goal-tool-resume-paused": "模型无法恢复已暂停的 Goal，请由用户恢复。",
  "error.goal-child-session": "仅顶层会话可使用 Goal。",
  "error.goal-busy": "请在会话空闲时操作 Goal。",
  "error.goal-objective-empty": "Goal 目标不能为空。",
  "error.goal-rounds-invalid": "Goal 轮次上限必须为正整数。",
  "error.goal-exists": "已有未完成的 Goal，请先 edit 或 clear。",
  "error.goal-missing": "当前会话没有 Goal。",
  "error.goal-pause-invalid": "只有 active Goal 可以暂停。",
  "error.goal-complete": "已完成的 Goal 无法恢复，请新建 Goal。",
  "error.goal-already-armed": "Goal 已在自动续跑。",
  "error.goal-round-limit": "Goal 已达轮次上限，请 edit 或新建 Goal。",

  "permission-mode.ask.name": "询问",
  "permission-mode.ask.description": "只读工具直接允许，其余请求批准",
  "permission-mode.ask.compact": "非只读需批准",
  "permission-mode.auto-review.name": "自动评审",
  "permission-mode.auto-review.description": "自动评审工具调用，有风险或评审失败时请求批准",
  "permission-mode.auto-review.compact": "评审，有风险询问",
  "permission-mode.full-access.name": "完全访问",
  "permission-mode.full-access.description": "允许所有工具调用，无权限拦截",
  "permission-mode.full-access.compact": "全部允许，无拦截",
  "approval.allow-once": "允许（仅本次）",
  "approval.allow-tool": "本 session 允许此工具",
  "approval.allow-command": "本 session 允许此命令",
  "approval.allow-directory": "本 session 允许此目录",
  "approval.allow-domain": "本 session 允许此域名",
  "approval.deny": "拒绝",
  "api-key.environment-default": "该提供方的标准环境变量",
  "error.ripgrep-unavailable":
    "内置 ripgrep 不可用。请重新安装 Neant 的依赖（包含 optionalDependencies），并检查平台兼容性或二进制执行权限。原因：{{cause}}",
  "error.allow-tools-retired": "{{source}}: allowTools 已移除，请迁移到 permissions.allow。",
  "error.permission-rule-invalid": '{{source}}: 无效的权限规则 "{{rule}}"',
  "error.unknown-model": '未知模型 "{{model}}"。',
  "error.no-api-key": '缺少 provider "{{provider}}" 的 API key。环境变量：{{env}}。',
  "error.session-not-found": "Session 不存在：{{id}}",
  "error.session-observation-readonly": "会话记录需要修复，无法以只读方式查看。",
  "error.hook-invalid-json": "无效的 hook JSON：{{cause}}",
  "error.hook-exit": "Hook 退出码为 {{exitCode}}：{{stderr}}",
  "error.hook-mcp-unconnected": "Hook MCP 服务未连接：{{server}}",
  "error.hook-mcp-failed": "Hook MCP 工具失败：{{server}}/{{tool}}",
  "error.hook-http-status": "Hook HTTP 响应状态：{{status}}",
  "error.hook-timeout": "Hook 在 {{timeout}} 秒后超时",
  "error.hook-crashed": "Hook 进程崩溃：{{signal}}",
  "error.hook-execution-failed": "Hook 执行失败：{{cause}}",
  "error.hook-command-failed": "Hook 命令执行失败：{{cause}}",
  "error.hook-model-failed": "Hook 模型执行失败：{{cause}}",
  "error.hook-type-unsupported": "尚不支持的 hook 类型：{{type}}",
  "error.hook-matcher-invalid": "{{source}}：无效的 hook 正则表达式：{{matcher}}",
  "error.hook-if-nontool": "{{source}}：if 仅支持工具事件，此 {{event}} hook 永不运行",
  "error.hook-output-ignored": "忽略无效或不支持的 hook 输出字段：{{field}}",
  "error.compaction-no-history": "没有可压缩的对话内容。",
  "error.side-question-empty": "侧问不能为空。",
  "error.side-question-failed": "侧问失败。",
  "error.side-question-provider-failed": "侧问失败：{{cause}}",
  "error.side-question-no-response": "未收到回答。",
  "error.session-title-empty": "会话标题不能为空。",
  "error.model-switch-busy": "请在会话空闲时切换模型。",
  "error.session-run-active": "会话已有正在进行的任务。",
  "error.session-rewinding": "会话正在回退。",
  "error.session-compacting": "会话正在压缩上下文。",
  "error.session-switching-models": "会话正在切换模型。",
  "error.compaction-hook-stopped": "Hook 已停止上下文压缩。",
  "error.compaction-hook-stopped-reason": "Hook 已停止上下文压缩：{{reason}}",
  "error.hook-compaction-blocked": "PreCompact hook 跳过本次压缩：{{reason}}",
  "error.hook-continuation-limit": "{{event}} hook 已达 {{limit}} 次续跑上限，忽略阻断",
  "error.hook-project-untrusted": "{{source}}：忽略 hooks，只有受信任的项目可以定义 hooks",
  "error.hook-config-invalid": "{{source}}：无效的 hooks 配置：{{cause}}",

  "error.no-model": `未配置模型。请在 {{settings}} 中设置 model，或传入 --model provider/id。
内置 provider 从标准环境变量读取密钥，例如 "model": "anthropic/<id>" 使用 ANTHROPIC_API_KEY。
自定义 OpenAI 兼容 provider 示例：
${modelExample}`,
} as const satisfies Record<`error.${UserVisibleErrorCode}`, string> & Record<string, string>;

const en = {
  "error.goal-tool-human-required": "Goal control requires direct human input in the current Run.",
  "error.goal-tool-completion-authority":
    "Goal completion requires direct human input or the current Goal round.",
  "error.goal-tool-invalid-argument": "{{field}} is valid only with action {{action}}.",
  "error.goal-tool-required-argument": "{{field}} is required with action {{action}}.",
  "error.goal-tool-resume-paused":
    "The model cannot resume a paused Goal; the user must resume it.",
  "error.goal-child-session": "Goals are only available in top-level Sessions.",
  "error.goal-busy": "Goal operation requires an idle Session.",
  "error.goal-objective-empty": "Goal objective cannot be empty.",
  "error.goal-rounds-invalid": "Goal maxRounds must be a positive integer.",
  "error.goal-exists": "An unfinished Goal already exists. Use edit or clear first.",
  "error.goal-missing": "No Goal exists in this Session.",
  "error.goal-pause-invalid": "Only an active Goal can be paused.",
  "error.goal-complete": "A complete Goal cannot be resumed. Create a new Goal.",
  "error.goal-already-armed": "Goal continuation is already armed.",
  "error.goal-round-limit": "Goal has reached its round limit. Edit or create a new Goal.",

  "permission-mode.ask.name": "Ask",
  "permission-mode.ask.description": "Read-only tools are allowed; other tools require approval",
  "permission-mode.ask.compact": "Other tools need approval",
  "permission-mode.auto-review.name": "Auto review",
  "permission-mode.auto-review.description": "Review tool calls; ask on risk or review failure",
  "permission-mode.auto-review.compact": "Review tools; ask on risk",
  "permission-mode.full-access.name": "Full access",
  "permission-mode.full-access.description": "Allow all tool calls without permission checks",
  "permission-mode.full-access.compact": "Allow all tools; no checks",
  "approval.allow-once": "Allow once",
  "approval.allow-tool": "Allow this tool for this session",
  "approval.allow-command": "Allow this command for this session",
  "approval.allow-directory": "Allow this directory for this session",
  "approval.allow-domain": "Allow this domain for this session",
  "approval.deny": "Deny",
  "api-key.environment-default": "the provider's standard environment variable",
  "error.ripgrep-unavailable":
    "Bundled ripgrep is unavailable. Reinstall Neant dependencies (including optionalDependencies) and check platform compatibility or binary execution permissions. Cause: {{cause}}",
  "error.allow-tools-retired":
    '{{source}}: "allowTools" has been removed; migrate to "permissions.allow".',
  "error.permission-rule-invalid": '{{source}}: invalid permission rule "{{rule}}"',
  "error.unknown-model": 'Unknown model "{{model}}".',
  "error.no-api-key": 'No API key for provider "{{provider}}". Environment variable: {{env}}.',
  "error.session-not-found": "Session not found: {{id}}",
  "error.session-observation-readonly":
    "Session history requires repair and cannot be viewed read-only.",
  "error.hook-invalid-json": "Invalid hook JSON: {{cause}}",
  "error.hook-exit": "Hook exited with code {{exitCode}}: {{stderr}}",
  "error.hook-mcp-unconnected": "Hook MCP server is not connected: {{server}}",
  "error.hook-mcp-failed": "Hook MCP tool failed: {{server}}/{{tool}}",
  "error.hook-http-status": "Hook HTTP response status: {{status}}",
  "error.hook-timeout": "Hook timed out after {{timeout}}s",
  "error.hook-crashed": "Hook crashed: {{signal}}",
  "error.hook-execution-failed": "Hook execution failed: {{cause}}",
  "error.hook-command-failed": "Hook command failed: {{cause}}",
  "error.hook-model-failed": "Hook model failed: {{cause}}",
  "error.hook-type-unsupported": "Unsupported hook type: {{type}}",
  "error.hook-matcher-invalid": "{{source}}: invalid hook regular expression: {{matcher}}",
  "error.hook-if-nontool":
    "{{source}}: if is only supported on tool events; this {{event}} hook will never run",
  "error.hook-output-ignored": "Ignoring invalid or unsupported hook output field: {{field}}",
  "error.compaction-no-history": "Session has no compactable conversation history.",
  "error.side-question-empty": "Side question cannot be empty.",
  "error.side-question-failed": "Side question failed.",
  "error.side-question-provider-failed": "Side question failed: {{cause}}",
  "error.side-question-no-response": "No response received.",
  "error.session-title-empty": "Session Title cannot be empty.",
  "error.model-switch-busy": "Model switching requires an idle Session.",
  "error.session-run-active": "Session already has an active Run.",
  "error.session-rewinding": "Session is rewinding.",
  "error.session-compacting": "Session is compacting.",
  "error.session-switching-models": "Session is switching models.",
  "error.compaction-hook-stopped": "Compaction stopped by hook.",
  "error.compaction-hook-stopped-reason": "Compaction stopped by hook: {{reason}}",
  "error.hook-compaction-blocked": "Compaction skipped by PreCompact hook: {{reason}}",
  "error.hook-continuation-limit":
    "{{event}} hook reached the {{limit}} continuation limit; ignoring block",
  "error.hook-project-untrusted":
    "{{source}}: ignoring hooks; only trusted projects can define hooks",
  "error.hook-config-invalid": "{{source}}: invalid hooks configuration: {{cause}}",

  "error.no-model": `No model configured. Set "model" in {{settings}} or pass --model provider/id.
Built-in providers read their standard env var, e.g. "model": "anthropic/<id>" with ANTHROPIC_API_KEY.
Example with a custom OpenAI-compatible provider:
${modelExample}`,
} satisfies Record<keyof typeof zh, string>;

export const common = { zh, en };
