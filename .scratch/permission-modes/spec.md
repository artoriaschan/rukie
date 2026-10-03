Status: ready-for-agent

# Spec: Permission Mode（ask / auto-review / full-access）

## Problem Statement

用户只有两种选择：每个写入/bash/MCP 调用都弹审批（打断频繁），或 `--yolo` 全放开（无任何保护）。缺一个中间档：只在 agent 真要做危险事时才问。运行中也无法切换，状态栏看不出当前处于哪种权限状态。

## Solution

引入 session 级 **Permission Mode**，三选一：

- `ask`（默认）：只读工具直接放行，其余问用户（即现状）。
- `auto-review`：每次非只读调用发起一次 **Permission Review**——独立模型调用判断风险，安全的放行，有风险或评审失败的问用户。
- `full-access`：全部放行，无任何拦截（原 `--yolo`）。

TUI 用 shift+tab 循环切换并在状态栏显示；settings 配默认值；CLI 用 `--permission-mode`。

## User Stories

1. As a TUI user, I want a default `ask` mode, so that nothing mutating runs without my consent unless I opt in.
2. As a TUI user, I want to press shift+tab to cycle `ask → auto-review → full-access → ask`, so that I can change trust level without restarting.
3. As a TUI user, I want the mode change to apply to the very next tool call, so that I can rein in a misbehaving agent mid-run.
4. As a TUI user, I want shift+tab ignored while the approval dialog is open, so that one stray key can't bulk-approve pending calls.
5. As a TUI user, I want the current mode always shown as the first field on status line row 2, so that I always know how much the agent may do unattended.
6. As a TUI user, I want `full-access` rendered in the danger color, so that the riskiest state is impossible to miss.
7. As a TUI user, I want the mode field's hover detail to explain the mode and mention shift+tab, so that I discover how to switch.
8. As a TUI user, I want a mode switch to last only for the current session, so that a temporary `full-access` never leaks into future sessions.
9. As a TUI user, I want a resumed session to start in the default mode, so that an old session can't silently come back with `full-access`.
10. As a user, I want to set my default mode with `permissionMode` in `~/.neant/settings.json`, so that I don't pass a flag every time.
11. As a user, I want a project `.neant/settings.json` unable to set `permissionMode` (dropped with a warning), so that a malicious repo can't grant itself `full-access`.
12. As a CLI user, I want `--permission-mode <ask|auto-review|full-access>`, so that scripts choose the mode explicitly.
13. As a CLI user, I want `--yolo` kept as an alias for `--permission-mode full-access`, so that existing usage keeps working.
14. As a CLI user in `auto-review`, I want safe calls to run and risky ones denied (ask = deny headless), so that unattended runs can make progress without doing dangerous things.
15. As a CLI user, I want a denied call returned to the model as an error tool result while the run continues, so that the model can adapt.
16. As a user in any mode, I want read / glob / grep / skill always allowed, so that reading code never prompts or costs a review.
17. As a user, I want tools in `allowTools` (settings, `--allow-tools`) to skip both asking and review, so that my explicit allowances are honored.
18. As a user in `auto-review`, I want each remaining call reviewed by a model that sees my instructions and prior tool calls, so that it can tell whether I actually authorized e.g. a force push.
19. As a user, I want the reviewer not to see assistant text or tool results, so that prompt injection in fetched content can't talk the reviewer into allowing.
20. As a user, I want low-risk actions (in-project edits, test/build, non-destructive git) allowed, so that ordinary work flows uninterrupted.
21. As a user, I want medium-risk actions (deleting existing things, force push, deploy, external writes) allowed only when I explicitly authorized that action, target and scope, so that the reviewer doesn't overreach.
22. As a user, I want high-risk actions (exfiltrating credentials or private data) always escalated to me, so that the worst outcomes always require a human.
23. As a user, I want a review deny to become an approval prompt rather than an outright rejection, so that I keep the final say.
24. As a user, I want the approval dialog body to show the reviewer's reason beneath the tool command or arguments, so that I know why I'm being asked.
25. As a user, I want the model told only "user rejected" when I decline, so that reviewer internals don't pollute the transcript.
26. As a user, I want review failures (provider error, invalid JSON, 30s timeout, oversized input) to fall back to asking me, so that a flaky reviewer never silently blocks or allows.
27. As a user in `auto-review`, I want the approval dialog to offer only "allow once" and "deny", so that "always allow this tool" can't quietly disable review for the rest of the session.
28. As a user, I want to configure `reviewModel` in settings (falling back to the main model), so that I can use a cheaper model for reviews.
29. As a user, I want esc to cancel in-flight reviews and treat those calls as denied, so that interrupting is immediate.
30. As a user, I want parallel tool calls in one turn reviewed concurrently, so that reviews don't serialize the turn.
31. As a TUI user, I want the ActivityLine to show a REVIEW phrase while a review runs, so that I know what the pause is.
32. As a stream-json consumer, I want `permission_review` start/end events with risk, decision and reason, so that I can observe review outcomes.
33. As a user with a long session, I want review input limited to history after the latest compaction and truncated oldest-first to half the review model's context window, so that reviews stay within limits.
34. As a user, I want review token usage excluded from Context Usage and the tokens field, so that status line numbers keep describing the main transcript.
35. As a user, I want mode switches not announced to the model, so that no tokens are spent on harness state the model doesn't need.

## Implementation Decisions

- **permissions 模块**：`decidePermission` 输入改为 `{ mode, toolName, allowTools }`，顺序：`full-access` → allow；只读工具 → allow；命中 `allowTools` → allow；`ask` → ask；`auto-review` → `review`（新的第四种结果，仅模块内/session 内使用，不改 `PermissionDecision` 对外三值）。`yolo` 布尔选项删除，由 mode 取代。
- **review 模块（新，`packages/agent` 下按概念一目录）**：纯输入 → 一次模型调用 → 解析结果。
  - 输入：cwd、project instructions、过滤后历史（最近 compaction 摘要之后；保留 user 消息与历史工具调用名+参数；丢弃 assistant 文本/thinking 与 tool result）、待执行调用（工具名、description、参数 schema、实参）。
  - system prompt 为固定 review policy（风险分级 low/medium/high 与 allow 条件照搬 dsh Auto review 的 `REVIEW_POLICY` 语义）。
  - 调用复用 session 的 `streamFn`（与 compaction 同法），模型取 `reviewModel` 否则主模型，`temperature: 0`，30s 超时与 run 的 abort signal 合并。
  - 输出严格 JSON：`{"risk":"low"|"medium","decision":"allow"}` 或 `{"risk":"medium"|"high","decision":"deny","reason"?:string}`；其它任何形状视为失败。
  - 超长：先截断旧历史至评审模型上下文窗口一半，仍超则失败。
  - 返回 `{ decision: "allow" } | { decision: "ask", reason }`；失败也返回 `ask`（reason 说明失败），abort 返回 deny。
- **session**：
  - `SessionOptions.permissionMode` 取代 `yolo`；session 对外新增 `setPermissionMode(mode)` / 读取当前 mode。`beforeToolCall` 每次读当前值。
  - `PermissionAskRequest` 增加 `mode` 与可选 `reason`（评审给出的理由），frontend 据此决定对话框选项与标题。
  - 新增自定义事件 `permission_review`：`{ phase: "start", toolCallId, toolName }` 与 `{ phase: "end", toolCallId, risk?, decision, reason? }`（类型放 shared events）。
  - 评审 token 不计入 context_usage。
- **settings schema**：新增 `permissionMode?: "ask" | "auto-review" | "full-access"`、`reviewModel?: string`。项目级文件的 `permissionMode` 丢弃并警告（与 `providers` 同法）；`reviewModel` 允许项目覆盖（与 `model` 一致）。
- **Headless CLI**：新增 `--permission-mode`；`--yolo` 等价 `--permission-mode full-access`，两者同时给出且冲突时报参数错误。不传 `onPermissionAsk`，ask 仍为 deny。
- **TUI**：
  - chat screen 持有当前 mode，shift+tab 循环并调用 `session.setPermissionMode`；对话框打开时忽略。
  - 状态栏 row 2 第一个字段 `mode`，`full-access` 用 danger 色，hover 详情含模式说明与 shift+tab 提示。StatusLine 仍只收 props。
  - 权限对话框：`mode === "auto-review"` 时只两项（允许一次 / 拒绝）；参考 dsh-TUI ApprovalPanel，标题显示“等待审批 · 工具名”，命令/参数与 `reason` 放在可滚动正文，正文下方显示“要允许这次操作吗？”（小窗口收紧留白并优先保留详情和选项）。选项与提示固定，ask 保留三项；数字键仍先选择，Enter 确认。
  - ActivityLine 新增 review 状态与 REVIEW 文案池，由 `permission_review` 事件驱动。
  - 也接受 `--permission-mode` / `--yolo`。

## Testing Decisions

好测试只验证外部行为：给定模式、模型输出和用户应答，工具是否执行、模型看到什么 tool result、发出什么事件、界面显示什么；不断言内部函数调用。

- **Agent Core e2e**（`createSession` + fake `streamFn`，参照现有 permissions e2e 测试）：fake model 按请求 system prompt 区分评审请求与主 turn。覆盖三模式判定、只读与 `allowTools` 优先级、评审 allow/deny→ask、失败（坏 JSON / provider 错 / 超时 / 超长）→ ask、评审输入不含 assistant 文本与工具结果、compaction 后截取、abort→deny、运行中 `setPermissionMode` 立即生效、`permission_review` 事件、评审 token 不进 context_usage。
- **config**（参照 `tests/config/`）：新字段解析，项目级 `permissionMode` 丢弃并警告。
- **TUI chat screen**（参照 chat permissions / status-line 测试）：shift+tab 循环与对话框打开时屏蔽、mode 字段文字与颜色、auto-review 对话框两选项、工具标题与可滚动 reason 正文、ActivityLine REVIEW 文案。
- **CLI 参数**（参照 `main.test.ts`）：`--permission-mode`、`--yolo` 别名与冲突报错。

## Out of Scope

- 静态风险规则（bash denylist/allowlist、cwd 路径判断）——见 ADR-0007。
- 沙箱（文件系统/网络隔离）。
- `full-access` 下的任何硬拦截。
- "一直允许"写回 settings、持久化授权规则、真正产生 `deny` 的规则引擎。
- 评审结果缓存、熔断、重试。
- 评审 token 计入成本统计。
- 模式切换通知模型；切换模式的二次确认框。
- 读取 MCP `readOnlyHint` 等注解。

## Further Notes

- 术语见 `CONTEXT.md`：Permission Decision、Permission Mode、Permission Review。决策依据见 ADR-0007。
- 参考：deepseek-harness `packages/experimental/auto-review/src/index.ts`（review policy、过滤历史、严格 JSON 解析）。差异：Neant 评审失败转 ask 而非直接拒绝；只读工具与 `allowTools` 不评审；auto-review 下不提供"一直允许"。
- SessionEvent / stream-json 目前无外部消费者，新增与删除字段（`yolo`）无需兼容层。

2026-10-03 用户后续要求：参考本地 dsh-TUI 的 ApprovalPanel 更新权限确认面板；该要求替代最初将 reason 放在标题的展示决定。Neant 保留当前两种模式的选项和按键语义。
