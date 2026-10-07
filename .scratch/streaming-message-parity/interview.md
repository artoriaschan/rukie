# 流式会话消息复刻访谈

## 状态

Q1–Q8 已确认。2026-10-07，用户调用 to-spec，确认进入规范阶段；规范见 [spec.md](spec.md)。本记录是设计范围与决定，不表示实现已完成。

## 已确认的范围

2026-10-07，用户回复“全部采用建议”，确认以下范围。

- 以本地 dsh-TUI 当前版本为参考，逐项对齐布局、颜色、间距、折叠、悬停、点击、快捷键、滚轮和流式更新；保留 Neant 品牌及中英本地化。参考提交为 `3c89ea516e4f7d2777efe979200016528722a0b4`，核对时参考工作区无改动。
- 覆盖用户消息、assistant 正文与 Markdown、思考、工具调用及结果、Background Job、Subagent、问题回答、计划评审、Todo、错误和中断提示。包含消息卡打开的详情面板；输入框、状态栏与无关设置页另行处理。
- 允许补齐支撑呈现所需的 Agent Core 数据或能力，保留 Neant 的 Session、权限、取消和恢复语义；冲突单独讨论。

2026-10-07，用户确认第二轮推荐，并明确“Q6 无需考虑老会话”。

- 纳入消息选择（Shift+↑、↑/↓、Enter、Esc）、按 Turn 导航和滚动时固定显示的用户提示；保留 Neant 输入历史、阅读位置与小终端规则。
- 从真实事件获得的数据可补齐；无法获得的字段省略或明确显示未知，不按运行时间推算进度，不把 Subagent 的一次 Run 正常结束等同于委派任务完成。
- 不考虑老会话的兼容与迁移。新会话保存无法重建的必要历史事实；展开、悬停、选择与滚动属于界面状态，恢复时使用参考默认值。Background Job 恢复后不重新运行。
- 根 AGENTS.md 的代码质量约束改为用户原文：`Do not preserve backward compatibility unless the user asks for it.`

2026-10-07，用户确认 Q7 推荐：采用 dsh-TUI 全屏自有选字与自动复制交互，替代 ADR-0006 的终端原生选字决定；同步更新该 ADR。终端恢复、阅读锚点和小终端规则继续保留。

2026-10-07，用户确认 Q8 推荐：保留 Neant 已写入 Transcript 的中断／错误部分正文与思考，追加明确的中断／错误提示；未提交的临时显示依据最终保存结果收束，实时与 Session Resume 的内容保持一致。这是相对 dsh-TUI 的明确语义差异，不引入新的 attempt 模型。

## 已核对的事实

dsh-TUI 的思考预览固定三行，工具普通输出预览三行、diff 预览八行；后台输出固定两行，子代理运行输出固定三行。正文使用流式 Markdown 和平滑显示。消息类型有各自的点击目标，不能统一为整卡折叠。参考源码入口为 `src/components/MessageList.tsx`、`src/components/messages/AssistantThinkingMessage.tsx`、`src/components/messages/AssistantToolUseMessage.tsx`、`src/components/Chat/JobCard.tsx`、`src/components/Chat/SubagentMessage.tsx`，具体契约还需形成验收清单。

Neant 已有 Tool View、Background Job 和 Subagent 呈现，assistant 正文目前直接使用 ThemedText，ThinkingRow 是标题加可选全文。现有领域定义见 [CONTEXT](../../CONTEXT.md)；[ADR-0006](../../docs/adr/0006-fullscreen-tui.md) 约束阅读位置、小终端行为及本轮已接受的自有选字决定，[ADR-0009](../../docs/adr/0009-subagent-resume-outcomes.md) 区分当前活动与历史 Run Outcome，[ADR-0010](../../docs/adr/0010-own-bash-tool-for-background-jobs.md) 说明 Background Job 执行路径。

## 参考调查修正

参考默认思考 preview 在首个正文 token 或工具调用到达时折叠；full 模式保持到 Turn 结束，不能将两者概括为当前 Turn 始终展开。参考 `src/channel/projection.ts` 的 `thinkingOpen` 更新及 `src/components/messages/AssistantThinkingMessage.tsx`。

参考中断处理区分没有 durable seq 的临时 attempt 与已提交消息：移除前者、保留后者，并显示中断提示。Neant 是否能映射这些事实还需核对；不可直接假定所有部分输出一律丢弃。

## 中断事实核对

Neant 将 pi 的最终 assistant message_end 写入 Transcript，包括 stopReason 为 aborted/error 且包含部分内容的消息；TUI 实时与恢复均呈现这些已保存的内容。当前事件没有 dsh-TUI 的 attempt 身份及 abandoned/committed 模型。源码证据：`packages/agent/src/session/index.ts` 的 message_end 处理、`apps/neant-tui/src/screens/chat/conversation.ts` 的 replayMessages 与 message_end 处理。不能将“中断消息”直接视为“没有持久化的临时消息”。

## 参考行为与验收方向

以下行为由固定版本的参考确定，不逐项重新选择偏好。形成规范时应补齐对应源码锚点及实际 Neant 差异，不将调查描述视为已完成的验证。

| 范围             | 参考行为                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户与 assistant | 用户气泡与指针；assistant Markdown 及流式 Markdown；空的已结束 assistant 不留孤立标记；普通正文支持选字                                                                                                               |
| 思考             | 默认 preview 为固定三行最新内容；首个正文 token 或工具调用到达时收起；full 模式保持到 Turn 结束；点击切换；显示真实耗时或可用 token 信息                                                                              |
| 工具             | 结构化 read、terminal、diff、search 与 generic 等 Tool View；状态、分类色、内容槽、悬停、展开及路径动作；普通输出三行、diff 八行预览；宽度达到 110 列自动双栏 diff；展开有 400 行窗口及披露，退出码与信号不被折叠隐藏 |
| 平滑显示         | 默认开启；约 30fps 自适应追赶；适用于正文、思考全文和新的运行中工具调用正文；历史直接完整显示，工具结果、错误及展开内容直接完整显示；完成后的正文游标追赶至已到达内容                                                 |
| Background Job   | 状态、ID、真实耗时及可获得的事实；两行输出尾部；标题打开并聚焦 jobs 面板，正文独立折叠命令；相邻任务分组，至少三个任务全部结束时默认自动折叠，失败与终止计数保持可见                                                  |
| Subagent         | 标题、当前工具、三行运行输出；结束收起，失败保留错误；卡片打开详情，独立入口打开主屏只读视图；当前活动与 Run Outcome 继续区分                                                                                         |
| 辅助消息         | 问题回答、计划评审、Todo、notice、错误、中断及适用的 compaction、Run 用量摘要；只呈现 Neant 实际产生的事实                                                                                                            |
| 阅读交互         | 全局与单条详情展开、消息选择、按 Turn 导航、固定用户提示、滚轮与 resize 阅读锚点、回底跟随；消息选择模式不将 job/subagent 当作普通可折叠消息                                                                          |
| 详情与复制       | jobs、Subagent 详情及只读视图、工具文件动作、内容选择和自动复制；保持各类卡片的独立点击目标，平台与远程终端处理采用参考行为                                                                                           |

输入框、状态栏和无关设置页不做整体外观复刻；阅读导航需要的按键协调属于范围内。参考已有的显示选项采用其默认值及相关能力，不将本次范围扩大为全部设置页重做。Neant 不存在的执行方式不会仅为生成辅助卡片而新增。

新会话应可重建消息顺序、最终内容、状态和必要历史元数据；界面展开、选区、悬停和滚动不持久化，Session Resume 使用默认状态。不为老会话新增兼容层或迁移。Background Job 不因 Resume 重新运行，Subagent 不自动续跑，未知结果不伪造为成功。

## 最终确认

用户调用 to-spec 确认进入规范阶段。规范已发布为 ready-for-agent；尚未修改运行代码，尚未进行代码行为测试。
