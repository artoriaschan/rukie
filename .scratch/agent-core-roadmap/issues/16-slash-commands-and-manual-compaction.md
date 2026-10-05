# 16: 自定义 Slash Command 与手动 compaction

Type: grilling
Status: resolved
Blocked by: None

## Question

Slash Command 已定属 frontend（`CONTEXT.md`），Agent Core 只暴露能力 API。本工单定：

- TUI 命令框架：内置命令清单（`/compact`、`/goal`、`/clear` …）、补全菜单、与 skills 的关系（skill 是否也能 `/` 调用）。
- 自定义命令：模板文件格式与加载位置（比照 skills 的用户级 / 项目级）、参数占位、由 Agent Core 加载还是 TUI 加载。
- 手动 compaction：Agent Core `compact()` API，可带用户指令；与自动 compaction 的事件、通知共用。
- Headless CLI 是否支持 prompt 里写 `/命令`。

已定于他处：`/rewind` 的行为见 [撤销改动 / checkpoint](13-checkpoint-and-rewind.md)，本工单只需把它纳入内置命令清单。

## Answer

**分层**：frontend 先匹配内置 Slash Command；匹配不上的 `/` 输入原样交给 Agent Core，尝试 Skill Invocation（现有 `skillInvocation`），仍不中即普通 prompt（同 dsh-TUI `Chat.tsx:2969-2982`）。不做自定义命令模板：复用 prompt 写成 skill（`CONTEXT.md` 已改）。

**内置命令**：`/compact [指令]`、`/clear`（新 session，旧可 resume）、`/rewind`（见 13）、`/goal`（占位，语义归 08）、`/plan`（直接开关 plan mode，不走审批）、`/help`、`/exit`、`/model`、`/resume`、`/context`、`/settings`、`/btw`、`/rename`。

**补全菜单**：照 dsh-TUI——单行以 `/` 开头弹出；名字前缀匹配、不区分大小写；Up/Down 循环、Tab 填 `/name `、Enter 执行；来源 = 内置 + 用户可调用 skill（同名内置优先，skill 行 `[skill]` 标签）；每行带 description；不做参数补全。

**run 中**：Enter 仍是 steer；`/skill` 随 steer 发出。内置命令仅 `/exit`（先中止 run）、`/help`、`/btw`、`/context`、`/rename` 可执行，其余提示"run 结束后再用"。

**手动 compaction**：`session.compact({ instructions? })`。仅空闲；不看 80% 阈值；无可压缩内容报错。`instructions` 为本次摘要的侧重点，透传 pi `customInstructions`，不进 transcript。复用 `compaction_start/end`，加 `trigger: "auto" | "manual"`；Pre/PostCompact hook `trigger: "manual"` 带 `custom_instructions`，PreCompact 可阻断（返回错误）；SessionStart(`compact`) 与 reminder 重注入同自动路径。

**`/model`**：Agent Core `setModel(spec)`，仅空闲；选择器列 settings 配置 + 内置 provider 模型，`/model provider/id` 直接切；写入 transcript、resume 恢复，不改 `settings.json`；继承父模型的子代理自下一个新建者起用新模型。

**`/resume` 与 Session 标题**：Agent Core `listSessions({ cwd })`（基于 store `list`，排除子 session）；选中后 dispose 当前、以 `resumeId` 重建，仅空闲。标题存 pi session name（`setName`）：首条 user prompt 发出即写清洗后前 40 字节作 fallback；同时异步调一次模型生成（照 dsh harness prompt：用消息语言，非 CJK ≈5 词 / CJK ≈10 字，输入 4KB、输出 64 token），失败仅告警保留 fallback，之后不再生成；可选设置 `titleModel`，默认主模型；子 session 不生成，用 subagent description；Headless 也生成。事件 `session_title_changed { title, source: "prompt" | "model" | "user" }`。`/rename <标题>` → `session.rename(title)`：固定、永不自动覆盖、取消在飞的生成；无参数时预填当前标题。显示：终端标题（`✦ 标题`，运行中 spinner）+ resume 选择器两行（标题 / `时间 · 条数 · model`，prompt 来源暗色）。

**`/context`**：Agent Core `contextReport()`；TUI 复刻 Claude Code（`components/ContextVisualization.tsx`）：静态快照渲染成本地输出（不进 Agent Core transcript）；格子图（10×10，窗口 ≥1M 为 20×10，<80 列缩小；`⛁⛀⛶⛝`）+ 图例（`model · used/total tokens (pct%)`、每类 `⛁ 类别: N tokens (p%)`）+ 明细区（MCP tools / Memory files / Skills / 子代理类型，`└ name: N tokens`）。类别：System prompt（仅系统提示词）、Memory files（`user-instructions` / `project-instructions` reminder 当前内容，按路径列）、System tools（含子代理类型）、MCP tools、Skills（列表 reminder）、Messages（其余，不重复计）、Free space、Compaction 预留（20%）。细分用 chars/4，总数优先最近 response 的真实 input tokens。不做 Suggestions。现有 `context_usage` 不变。

**`/settings`**：占位。复刻 dsh-TUI `screens/Settings.tsx` 的全屏框架（标题行 + `1/N`、圆角分区卡片、`❯` 指针 + `selectionBg`、`[✓ ]` / `‹ 值 ›`、页脚分隔线 + 通知行 + 按键提示；↑↓ / Enter / ←→ / Esc），内容待定，暂为空状态。

**`/btw`**：照 dsh-TUI——Agent Core `sideQuestion(question, { signal })`：单轮无工具，用当前上下文（剔除未出结果的 tool call 并注明仍在执行），不进 transcript；TUI overlay 流式显示、Esc 关闭；run 中可用；空参数提示用法。

**Headless CLI**：只有 Skill Invocation；不解析内置命令。

参考：dsh-TUI `src/commands.ts`、`src/screens/Chat.tsx`、`src/screens/Settings.tsx`、`src/dsh-adapter/sideQuestion.ts`；deepseek-harness `packages/session/session-title*`；claude-code `src/components/ContextVisualization.tsx`、`src/utils/analyzeContext.ts`。

Spec：[Slash Command 与手动 compaction](../../slash-commands/spec.md)
