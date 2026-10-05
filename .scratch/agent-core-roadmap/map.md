Labels: wayfinder:map

# Map: Agent Core 能力路线图

## Destination

一份 Agent Core 能力路线图：要补哪些能力、按什么顺序、彼此怎么依赖，以及每项进入 `/grill-with-docs` 前必须先定的跨项决策。地图不深入单项实现；每项走出地图后各自 `/grill-with-docs` → `/to-spec`。

## Notes

- 定位：Neant 是用户的第二工具 / 学习实验项目，不替代日常主力。"完整"的取舍以用户日常是否用得上为准，Claude Code 本地核心功能作参考清单。
- 范围：Agent Core 加 frontend 必需交互面（TUI 呈现、Headless CLI 降级）。server 与桌面端不在内。
- 排序原则：先地基（被多项依赖的公共机制），再按学习价值（架构难度大的先）。sandbox 优先级最低。
- 地基工单需写明子代理如何使用该地基，作为验证场景。
- 每个 grilling 工单调用 `grilling` 与 `domain-modeling`；遵守 `CONTEXT.md` 术语与 `docs/adr/`。
- 已在 charting 中定下（详见各工单 Question 前提）：Slash Command 属 frontend，Agent Core 只暴露能力 API（已入 `CONTEXT.md`）；Goal 续跑归 Agent Core，参考 deepseek-harness `packages/goal`；goal 与 todo 独立。
- 工具命名：与 Claude Code 同名工具对齐，改 snake_case（如 `ask_user_question`、`web_fetch`）。
- 参考实现：deepseek-harness（`~/Workspaces/agent/deepseek-harness`）、dsh-TUI（`~/Workspaces/agent/dsh-TUI`）。

## Decisions so far

- [子代理参考实现调研](issues/04-research-subagent-prior-art.md): 三者都只回传最终文本、子 transcript 为带 parent 链接的独立 JSONL、进度走事件；分歧在权限（Claude Code 冒泡给用户 vs harness 固定 never 自动拒绝）、嵌套深度（3 vs 1）、定义方式（具名 markdown vs provider 配置）；dsh-TUI 运行时即 harness 包
- [权限规则 / hooks / checkpoint 参考实现调研](issues/05-research-rules-hooks-checkpoint-prior-art.md): CC/Codex 都是固定顺序 hooks（可改写）→ 规则（deny>ask>allow 取最严、跨层合并、复合命令拆分逐段判）→ 审批 → 执行 → post，hook allow 绕不过规则；DSH 无规则只有 sandbox×approval preset、hooks 不可改写；checkpoint 仅 CC 现存（每 prompt、只跟踪文件工具不含 bash），Codex 整树 ghost 快照已移除，DSH 影子 git 只作 diff
- [地基 A：Agent Core → frontend 交互通道](issues/01-interaction-channel.md): 每种交互一个回调 + 内部共享 helper；无回调时先去工具、再取安全默认值；交互内拒绝不影响 run，run 中止以取消结束；不进 transcript；子代理经顶层回调转发并带 origin
- [向用户提问（ask user）](issues/09-ask-user.md): 工具 `ask_user_question`（命名约定：对齐 Claude Code 同名工具、snake_case）+ 回调 `onQuestion`；照 CC 1–4 题 × 2–4 选项、无 preview、自由输入由 frontend 附加；不走审批；纯文本结果，拒绝回答非错误；无超时；TUI 与审批共用槽位、统一 FIFO；transcript 由工具参数 + 结果渲染摘要；子代理是否可用交子代理工单
- [地基 B：工具状态进 transcript](issues/02-tool-state-in-transcript.md): 术语 Tool State；pi `custom` entry `tool-state/<name>` 存带版本的完整快照，last-wins，坏记录退回上一条并告警；resume 需见的事实才持久（armed 等易失）；反馈渠道各自定，默认复用 ReminderSource，compaction 后立即重注入；frontend 经 `tool_state_changed` 事件 + `toolState(name)`；子代理为独立 session 经 `parentSessionId` 链接，父 tool result `details` 记 `childSessionId`
- [todo 工具](issues/07-todo.md): 单个 `todo_write` 整表覆盖（不做 CC V2 Task* 四件套：为 swarm 共享任务表而生）；`{content,status}` 三态、不限 in_progress 个数、不自动清空；Tool State `todo` + 有未完成项时的 `todo` reminder，无催促；TUI 复刻 dsh-TUI `GoalTodoPanel`（树形、`ctrl+q`/点击折叠、空闲隐藏已完成），Goal 根行归 Goal 工单；工具卡 `todos ✓ done/total`
- [地基 C：工具调用前后拦截点](issues/03-tool-call-interception.md): 内部固定阶段 hooks（可原地改写参数）→ 规则 → Permission Mode → 交互 → 放行后（供 checkpoint）→ 执行 → after（仅 hooks：替换结果 / 注入 reminder）；取最严、hook allow 越不过规则 deny；full-access 只免询问、不跳规则与 hooks；sandbox 不进链；子代理按引用共享父配置，只可收窄
- [权限规则与 sandbox](issues/11-permission-rules-and-sandbox.md): `permissions.{allow,ask,deny}` 用 `tool(specifier)`（bash 命令 glob、文件路径 glob、裸名）；复合命令拆段，deny/ask 任一段命中、allow 需每段命中；用户层 + 项目层合并，项目 allow 仅 trusted；删 `allowTools`；ask 规则在 full-access / auto-review 下也问用户；"本 session 允许"生成内存规则（精确命令 / 目录 / 工具名）；realpath 防 symlink；sandbox 不做
- [子代理](issues/06-subagent.md): 子 session 可多 run（`subagent` / `subagent_fork` / `send_message` / `list_agents`，对齐 harness）；默认后台，父 run 等子代理全部结束，结束通知 steer 成 user 消息；深度 1、running 上限 8、父中止级联；内置 general-purpose / explore + `agents/*.md` 自定义类型（可配 model）；`subagent_event` 包装转发；TUI 复刻 dsh-TUI 卡片 / dashboard / 详情页，新增子代理面板，输入框上方面板固定顺序且同时显示

- [plan mode](issues/10-plan-mode.md): 与 Permission Mode 正交的 session 开关；照 harness 只引导不限制工具（推翻地基 C 的内置 deny）；Tool State `plan` resume 保留；plan reminder 不改 System Prompt；常驻 `enter_plan_mode`（需批准）/ `exit_plan_mode { plan }`；回调 `onPlanReview` 批准 / 继续规划+反馈 / Esc 接手，批准不改 Permission Mode；Headless 无此能力；子代理共享状态、无两工具；TUI 照 dsh-TUI 评审面板 + plan 色边框 + chip
- [hooks](issues/12-hooks.md): 对齐 CC——stdin JSON / exit 2 阻断 / `hookSpecificOutput`；14 种事件（工具前后与失败、PermissionRequest/Denied、UserPromptSubmit、Session Start/End、Stop、Subagent Start/Stop、Pre/PostCompact、Notification）；matcher 正则 + `if` 权限规则；五种类型、CC 默认超时、fail-open；并行各拿原始输入，`updatedInput` 最后完成者生效再过规则；Stop/SubagentStop 可 block 续跑（上限 8，先于 Goal）；项目层与 `agents/*.md` hooks 需 Trusted Project；`updatedPermissions` 仅 session
- [撤销改动 / checkpoint](issues/13-checkpoint-and-rewind.md): 照 CC file history——地基 C 放行后阶段、文件首次写前存副本（不含 bash），每条 user prompt 一个 Checkpoint，子代理写入归父；副本 `~/.neant/file-history/` 30 天清理，引用作 Tool State `checkpoint`；Rewind 三选一（代码+对话 / 只对话 / 只代码），对话回退移 `branchTip`，代码直接覆盖、新建文件删除；仅空闲可用，可跨 compaction；`/rewind` + 空输入双击 Esc，prompt 填回输入框；Session `checkpoints()` / `rewind()`，Headless 无
- [自定义 Slash Command 与手动 compaction](issues/16-slash-commands-and-manual-compaction.md): 不做自定义命令（复用 prompt 写成 skill），frontend 未匹配的 `/` 输入交 Agent Core 试 Skill Invocation；13 个内置命令（含 `/model`、`/resume`、`/context`、`/settings` 占位、`/btw`、`/rename`），dsh 式补全，run 中仅只读类可用；`compact({ instructions })` 仅空闲、`trigger: manual`；新增 `setModel` / `listSessions` / `contextReport` / `sideQuestion` / `rename`；Session 标题 = 首条 prompt fallback + 一次模型生成，手动改名固定；`/context` 复刻 CC 格子图；Headless 只有 Skill Invocation
- [Goal](issues/08-goal.md): Session `goal` + `createGoal/editGoal/pauseGoal/resumeGoal/clearGoal`；工具 `create_goal` / `update_goal`（无 CAS，故不做 `get_goal`）；`goal` reminder 在 compaction 后重注入以保住 objective；只走 `tool_state_changed`，不加 activation 事件；`/goal` 照 DSH 文法，run 中仅查看 / pause / clear；Headless `--goal` 与 `-p` 互斥，退出码 0/1；TUI 复刻 dsh-TUI 根行 PhaseBadge + statusline chip + 工具卡，round 消息不渲染气泡；子代理不可用；上限 256 不可配
- [web fetch](issues/15-web-fetch.md): `web_fetch { url }`，不用小模型提炼，turndown 转 markdown，50K 字符截断；5 MB / 30 s / 无缓存；不免询问，规则 `web_fetch(domain:…)`，无预批准域名；同源重定向最多 5 跳，跨源返回文本让模型重新调用；SSRF 照 DSH：只接受公网单播，并用 undici（`undici/index.js` 绕开 Bun stub）钉 IP；代理走 `EnvHttpProxyAgent`；TUI 复刻 dsh 通用卡，另开工单
- [文件外部修改检测](issues/17-external-file-change-reminder.md): 跟踪 read/write/edit 过的文件（不含 bash），写后更新基线；每次模型请求前比 mtime+size 再比哈希；`file-changes` reminder 附 diff（单文件 4K / 总 16K，超限只列路径），删除报已删除；edit/write 前过期检查，读后被改则报错要求重读；Tool State `file-tracking` 只存元数据+哈希，resume 后只报已变更；compaction 后保留跟踪；子代理写入与 rewind 恢复按外部修改自然处理；frontend 不加呈现
- [图片输入](issues/18-image-input.md): TUI Ctrl+V（文件 → 图片 → 文本）+ 粘贴图片路径识别，插入 dsh 式原子 `[Image #N]` token；base64 内联存 transcript，不缩放、超 5 MB / 8000 px 拒绝；自定义模型加 `input`，非视觉模型只 notice、降级交 pi-ai；`run/steer(prompt, { images })`；Context Usage `w*h/750` 上限 1,600；Headless 靠 read；无图形能力时 `[Image · name]` 占位 + 系统查看器；缩略图 / 预览浮层另开工单

## Not yet specified

- 最终排序与 handoff：所有能力工单定完后，汇总依赖图、给出实现顺序。

## Out of scope

- web search：需选搜索服务商与管理 API key，用户未纳入本轮。
- multi-edit / apply_patch：edit 足够，成瓶颈再议。
- MCP resources / prompts：极少 server 使用。
- server 与桌面端。
- sandbox（OS 级写入隔离，macOS `sandbox-exec` / Linux bwrap）：需单独调研，本轮规则已覆盖日常需求；见 [权限规则与 sandbox](issues/11-permission-rules-and-sandbox.md)。
- 多 agent 共享任务表（CC V2 `TaskCreate/Get/List/Update`、dsh `agent-team` 任务板）：Neant 子代理各自独立 session，无共享场景；见 [todo 工具](issues/07-todo.md)。
- compaction 后重新附上最近读过的文件（CC 做法）：超出外部修改检测范围；见 [文件外部修改检测](issues/17-external-file-change-reminder.md)。
- `@路径` 文件提及、sixel / iTerm2 图形协议、sharp 缩放与非 PNG 缩略图、Headless `--image`、Windows 剪贴板：本轮不做；见 [图片输入](issues/18-image-input.md)。
- 其余 CC hook 事件（PostToolBatch、StopFailure、FileChanged、Worktree*、Task* 等）：无对应能力或用不上；见 [hooks](issues/12-hooks.md)。
