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
} as const;

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
} satisfies Record<keyof typeof zh, string>;

export const common = { zh, en };
