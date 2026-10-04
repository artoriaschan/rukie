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
  "approval.deny": "拒绝",
  "api-key.environment-default": "该提供方的标准环境变量",
  "error.ripgrep-unavailable":
    "内置 ripgrep 不可用。请重新安装 Neant 的依赖（包含 optionalDependencies），并检查平台兼容性或二进制执行权限。原因：{{cause}}",
  "error.allow-tools-retired": "{{source}}: allowTools 已移除，请迁移到 permissions.allow。",
  "error.permission-rule-invalid": '{{source}}: 无效的权限规则 "{{rule}}"',
  "error.unknown-model": '未知模型 "{{model}}"。',
  "error.no-api-key": '缺少 provider "{{provider}}" 的 API key。环境变量：{{env}}。',
  "error.session-not-found": "Session 不存在：{{id}}",
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
