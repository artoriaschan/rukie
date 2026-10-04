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
  "approval.allow-tool": "本 session 内一直允许这个工具",
  "approval.deny": "拒绝",
  "api-key.environment-default": "该提供方的标准环境变量",
  "error.ripgrep-unavailable":
    "内置 ripgrep 不可用。请重新安装 Neant 的依赖（包含 optionalDependencies），并检查平台兼容性或二进制执行权限。原因：{{cause}}",
  "error.allow-tools-retired": "{{source}}: allowTools 已移除，请迁移到 permissions.allow。",
  "error.permission-rule-invalid": '{{source}}: 无效的权限规则 "{{rule}}"',
  "error.unknown-model": '未知模型 "{{model}}"。',
  "error.no-api-key": '缺少 provider "{{provider}}" 的 API key。环境变量：{{env}}。',
  "error.session-not-found": "Session 不存在：{{id}}",

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
  "approval.allow-tool": "Always allow this tool for this session",
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

  "error.no-model": `No model configured. Set "model" in {{settings}} or pass --model provider/id.
Built-in providers read their standard env var, e.g. "model": "anthropic/<id>" with ANTHROPIC_API_KEY.
Example with a custom OpenAI-compatible provider:
${modelExample}`,
} satisfies Record<keyof typeof zh, string>;

export const common = { zh, en };
