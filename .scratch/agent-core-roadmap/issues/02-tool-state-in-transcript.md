# 02: 地基 B：工具状态进 transcript

Type: grilling
Status: resolved
Blocked by: None

## Question

工具产生的、需要跨 run / resume 存活的状态，怎么记进 transcript 并在恢复时重建？

用例：todo 列表、Goal（参考 deepseek-harness `goal/change` 完整快照事件 + 回放折叠）、checkpoint 快照引用、子代理结果。

需定：

- 用 Session Store 里的独立事件类型（与模型消息分离），还是嵌在 tool result 里。
- 快照（last-wins）还是增量；回放时坏记录报错还是跳过。
- 这些状态如何反馈给模型：system reminder、tool result、还是 Goal 那样留在历史里的用户消息。
- compaction 后状态是否保留、如何重新告知模型。
- 进程内易失状态（如 Goal 的 armed）与持久状态的边界原则。
- 子代理验证场景：子代理自身的 transcript 存在哪、父 transcript 记什么。

## Answer

2026-10-04 grilling 结论（术语 **Tool State** 已入 `CONTEXT.md`，Transcript 定义放宽为"消息与 Tool State 记录"）。参考：deepseek-harness `todo/write`、`goal/change` 均为独立事件 + 完整快照。

1. **存储：pi `custom` entry**，与模型消息同在 `main` 分支、按序穿插。不嵌 tool result（Goal 有非工具触发的变化），不用 session `setValue` KV（rewind / fork 到某 entry 时状态需随之回到该点）。
2. **完整快照，last-wins。** 不做增量折叠。
3. **坏记录：跳过，退回上一条有效快照，经 `onWarning` 告警。** session 照常 resume。（比上游 goal 的"整个 projection 失效并抛错"宽松。）
4. **易失 / 持久边界：** resume 后用户或模型仍需看到的事实持久化；"当前进程正在做什么"不持久化。例：Goal phase / objective / round 计数持久，armed 易失；后台进程只记已启动过的 id 与命令，resume 时标为已终止。
5. **记录格式：** `customType: "tool-state/<name>"`，`data: { version: number, value: JsonValue }`。每种 Tool State 自带 `parse`（版本 + schema 校验），失败按第 3 条处理。代码放新目录 `packages/agent/src/tool-state/`。
6. **反馈给模型：由各 Tool State 自定**，地基只保证回放出的当前状态可作为 `ReminderSource.currentContent`；默认走现有 reminder 去重机制（每 run 开始、内容变了才注入）。具体 todo / Goal 走哪条渠道归各自工单。
7. **compaction 后：** compaction 结束时立即把所有 Tool State 当前 reminder 追加到摘要之后并写入 transcript（当前 run 后续 turn 即可见）；Tool State reminder 的去重比较以最后一次 compaction 之后的消息为准。现有 skills / mcp reminder 也有"以全 transcript 去重、compaction 后不重发"的同类缺陷，不在本地基内修。
8. **frontend 读取：** 新 `SessionEvent` `tool_state_changed { name, value }`，变化时发出；Session 暴露 `toolState(name)` 供 resume 后首次渲染。frontend 不读存储格式。
9. **子代理验证场景：** 子代理是独立 Session Store session，经 pi `SessionCreateOptions.parentSessionId` 链接父 session；父 transcript 只在该 tool result `details` 记 `childSessionId`，结果文本照常走 tool result。子代理自身 Tool State（如它的 todo）记在自己 transcript，与父互不影响。父 session 是否另记子代理目录 Tool State（类似上游 `subagent/catalog`，后台子代理需要）归子代理工单，届时按第 4 条：运行中易失，resume 标终止。
