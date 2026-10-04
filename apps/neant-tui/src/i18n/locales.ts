/**
 * BSD 3-Clause License
 *
 * Copyright (c) 2026, chimney (ccch1mneyyy)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Adapted from dsh-working-activity 0.5.1: src/lang.ts narration and activity copy.
 */

const zh = {
  "todo.fold": "Ctrl+Q 折叠",
  "todo.more": "… 还有 {{count}} 项",
  "question.summary": "提问",
  "question.unanswered": "未回答",
  "narrate-instruction":
    "[状态栏] 你有一个状态栏展示给用户。【必须】在每个步骤/子任务开始时（不只是调用工具前），在回复正文的最前面单独写一行：⏵ 你在做的具体事情（不超过20字），然后换行继续正常回复。整轮回复只写一行 ⏵，不要重复。信息为主——让人一眼知道你在干什么，风格自然、可以带点俏皮。例：⏵ 修复登录页样式、⏵ 查一下报错原因、⏵ 给补丁跑个验证。切换任务时必须更新。",
  "line-elapsed": "总{{elapsed}}",
  "done-summary": "{{tools}} · 想{{thinking}} 干{{tooling}}",
  "tool-count-one": "{{count}} 工具",
  "tool-count-many": "{{count}} 工具",
  "tool-streak": "工具x{{count}}",

  "logo.effort.off": "推理强度：关闭",
  "logo.effort.minimal": "推理强度：最低",
  "logo.effort.low": "推理强度：低",
  "logo.effort.medium": "推理强度：中",
  "logo.effort.high": "推理强度：高",
  "logo.effort.xhigh": "推理强度：极高",
  "logo.effort.max": "推理强度：最高",

  "notice.compaction": "上下文已压缩（{{tokens}} tokens）",
  "notice.mcp-error": "MCP 服务器 {{server}} 出错：{{error}}",
  "scroll.return": "回到底部（Ctrl+End）",
  "scroll.unread": "有新输出 · 回到底部（Ctrl+End）",
  "context.warning": "⚠ 上下文 {{percent}}% · ",
  "window.small": "请调整窗口至至少 40 列 × 12 行 · Ctrl+C 中断/退出",
  "status.ctx": "ctx",
  "status.tps": "tps",
  "status.tps-idle": "t/s",
  "status.cache-rate": "缓存 {{percent}}%",
  "status.mode": "模式",
  "status.switch-mode": "shift+tab 切换模式",
  "status.switch": "shift+tab 切换",
  "status.interrupt": "esc 中断",
  "status.system": "系统",
  "status.prompt": "提示词",
  "status.assistant": "助手",
  "status.thinking": "思考",
  "status.tools": "工具",
  "status.system-short": "sys",
  "status.prompt-short": "pr",
  "status.assistant-short": "ast",
  "status.thinking-short": "th",
  "status.tools-short": "tl",
  "status.free": "剩余",
  "status.cache": "缓存",
  "status.read": "读取",
  "status.write": "写入",
  "status.input": "输入",
  "status.model": "模型",
  "status.provider": "提供商",
  "status.git": "git",
  "status.cwd": "cwd",
  "status.in": "输入",
  "status.out": "输出",
  "status.total": "总计",
  "status.avg60": "avg60",
  "status.mean": "均值",
  "status.p95": "p95",

  "question.progress": "第 {{current}} / 共 {{total}} 题",
  "question.switch": "Tab/←→切题",
  "question.switch-short": "Tab/←→",
  "question.select-short": "↑↓/1-9",
  "question.select": "↑↓/1-9选择",
  "question.toggle": "Space勾选",
  "question.other": "其他",
  "question.keep": "Space保留选项+其他附言",
  "question.keep-short": "Space留选+其他",
  "dialog.title": "等待审批 · {{tool}}",
  "dialog.question": "要允许这次操作吗？",
  "dialog.select": "↑↓选择",
  "dialog.confirm": "Enter确认",
  "dialog.deny": "Esc拒绝",
  "dialog.transcript": "Tab主体",
  "dialog.details": "Tab详情",
  "startup.terminal": "neant 需要交互式终端。管道或非交互式输出请使用 neant-cli。",
  "startup.warning": "警告：{{warning}}",
  "argv.unexpected": "多余参数：{{argument}}",
  "argv.allow-tools": "--allow-tools 需要非空的工具匹配模式",
  "argv.permission-mode": "--permission-mode 必须为以下值之一：{{values}}",
  "argv.yolo-conflict": "--yolo 与 --permission-mode 冲突；--yolo 需要 full-access",
  "argv.model": '--model 必须为 provider/id，收到 "{{model}}"',
  "argv.thinking": "--thinking 必须为以下值之一：{{values}}",
  "argv.unknown-option": "未知选项：{{option}}。若它是以 '-' 开头的位置参数，请放在 '--' 后。",
  "argv.missing-value": "选项 {{option}} 缺少参数",
  "argv.unexpected-value": "选项 {{option}} 不接受参数",
  "argv.invalid-value": "选项 {{option}} 的参数无效；以 '-' 开头的值请使用 --option=value",
} as const;

const en = {
  "todo.fold": "Ctrl+Q fold",
  "todo.more": "… {{count}} more",
  "question.summary": "Questions",
  "question.unanswered": "Unanswered",
  "narrate-instruction":
    "[Status line] You have a status line visible to the user. [Required] At the start of each step or subtask (not only before tool calls), write exactly one standalone line at the very beginning of your response: ⏵ a concrete description of what you are doing (20 words max), then continue with the normal response on the next line. Write only one ⏵ line per response and do not repeat it. Prioritize information so the user can understand the current work at a glance; keep the style natural and optionally playful. Examples: ⏵ Fixing the login page styles, ⏵ Investigating the error, ⏵ Running validation for the patch. Update it when the task changes.",
  "line-elapsed": "total {{elapsed}}",
  "done-summary": "{{tools}} · thought {{thinking}} worked {{tooling}}",
  "tool-count-one": "{{count}} tool",
  "tool-count-many": "{{count}} tools",
  "tool-streak": "tool x{{count}}",

  "logo.effort.off": "Off effort",
  "logo.effort.minimal": "Minimal effort",
  "logo.effort.low": "Low effort",
  "logo.effort.medium": "Medium effort",
  "logo.effort.high": "High effort",
  "logo.effort.xhigh": "Xhigh effort",
  "logo.effort.max": "Max effort",

  "notice.compaction": "Context compacted ({{tokens}} tokens)",
  "notice.mcp-error": "MCP server {{server}}: {{error}}",
  "scroll.return": "Back to bottom (Ctrl+End)",
  "scroll.unread": "New output · Back to bottom (Ctrl+End)",
  "context.warning": "⚠ Context {{percent}}% · ",
  "window.small": "Resize to at least 40 columns × 12 rows · Ctrl+C interrupt/exit",
  "status.ctx": "ctx",
  "status.tps": "tps",
  "status.tps-idle": "t/s",
  "status.cache-rate": "cache {{percent}}%",
  "status.mode": "Mode",
  "status.switch-mode": "shift+tab switch mode",
  "status.switch": "shift+tab switch",
  "status.interrupt": "esc interrupt",
  "status.system": "system",
  "status.prompt": "prompt",
  "status.assistant": "assistant",
  "status.thinking": "thinking",
  "status.tools": "tools",
  "status.system-short": "sys",
  "status.prompt-short": "pr",
  "status.assistant-short": "ast",
  "status.thinking-short": "th",
  "status.tools-short": "tl",
  "status.free": "free",
  "status.cache": "cache",
  "status.read": "read",
  "status.write": "write",
  "status.input": "input",
  "status.model": "model",
  "status.provider": "provider",
  "status.git": "git",
  "status.cwd": "cwd",
  "status.in": "in",
  "status.out": "out",
  "status.total": "total",
  "status.avg60": "avg60",
  "status.mean": "mean",
  "status.p95": "p95",

  "question.progress": "Question {{current}} / {{total}}",
  "question.switch": "Tab/←→ switch",
  "question.switch-short": "Tab/←→",
  "question.select-short": "↑↓/1-9",
  "question.select": "↑↓/1-9 select",
  "question.toggle": "Space toggle",
  "question.other": "Other",
  "question.keep": "Space keep choice + Other",
  "question.keep-short": "Space + Other",
  "dialog.title": "Waiting for approval · {{tool}}",
  "dialog.question": "Allow this operation?",
  "dialog.select": "↑↓ select",
  "dialog.confirm": "Enter confirm",
  "dialog.deny": "Esc deny",
  "dialog.transcript": "Tab transcript",
  "dialog.details": "Tab details",
  "startup.terminal":
    "neant requires an interactive terminal. Use neant-cli for piped or non-interactive output.",
  "startup.warning": "Warning: {{warning}}",
  "argv.unexpected": "Unexpected argument: {{argument}}",
  "argv.allow-tools": "--allow-tools requires non-empty tool patterns",
  "argv.permission-mode": "--permission-mode must be one of {{values}}",
  "argv.yolo-conflict": "--yolo conflicts with --permission-mode; --yolo requires full-access",
  "argv.model": '--model must be provider/id, got "{{model}}"',
  "argv.thinking": "--thinking must be one of {{values}}",
  "argv.unknown-option":
    "Unknown option '{{option}}'. For positional arguments starting with '-', place them after '--'.",
  "argv.missing-value": "Option '{{option}}' argument missing",
  "argv.unexpected-value": "Option '{{option}}' does not take an argument",
  "argv.invalid-value":
    "Invalid argument for option '{{option}}'; use --option=value for values starting with '-'",
} satisfies Record<keyof typeof zh, string>;

export const appCopy = { zh, en };
