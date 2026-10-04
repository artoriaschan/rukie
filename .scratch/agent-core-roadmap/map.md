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

## Not yet specified

- 子代理的并发与上下文隔离细节（并行数、取消传播、token 计量归属），等子代理工单定了地基用法后再拆。
- 最终排序与 handoff：所有能力工单定完后，汇总依赖图、给出实现顺序。

## Out of scope

- web search：需选搜索服务商与管理 API key，用户未纳入本轮。
- multi-edit / apply_patch：edit 足够，成瓶颈再议。
- MCP resources / prompts：极少 server 使用。
- server 与桌面端。
- sandbox（OS 级写入隔离，macOS `sandbox-exec` / Linux bwrap）：需单独调研，本轮规则已覆盖日常需求；见 [权限规则与 sandbox](issues/11-permission-rules-and-sandbox.md)。
- 多 agent 共享任务表（CC V2 `TaskCreate/Get/List/Update`、dsh `agent-team` 任务板）：Neant 子代理各自独立 session，无共享场景；见 [todo 工具](issues/07-todo.md)。
