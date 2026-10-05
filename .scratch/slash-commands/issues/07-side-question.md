# 07: `/btw` 侧问

**What to build:** 用户在 TUI 输入 `/btw <问题>`（run 中也可以），overlay 里流式显示一个基于当前上下文的单轮回答，不打断主 run、不进 transcript，Esc 关闭并中止。见 [spec](../spec.md) 的“侧问”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** resolved

- [x] Session 新增 `sideQuestion(question, { signal })`：流式返回文本；空闲与 run 中都可用
- [x] 请求：当前恢复后的上下文，剔除没有结果的 tool call，追加按 dsh-TUI `wrapSideQuestion` 包裹的 user 消息（只基于已有上下文、无工具、列出仍在执行的调用）；不带工具定义
- [x] 不写 transcript、不触发 hooks 与 reminder、不发 Session 事件；signal 能中止
- [x] TUI overlay：流式显示问题与回答，Esc 关闭并中止；再发侧问中止前一个；空参数只提示用法
- [x] 测试工具：`controlledModel` 把侧问调用分到独立队列（若 03 已有分流机制则复用）
- [x] Agent Core e2e 与 TUI 测试覆盖以上行为

## Answer

新增 `Session.sideQuestion()` 文本异步迭代器及 `side-question` 模块：调用时独立捕获当前模型和恢复后的消息快照，保留已有 reminder，不重新收集；过滤所有无结果的工具调用，仍在当前 turn 等待结果者进入 dsh-TUI 原样包裹说明（名称与单行参数，400 字符上限且不截断代理对）。所有历史 system 消息的 `toolsAdded` / `toolsRemoved` 都剔除；请求不经 Agent loop、hooks、store、usage 或 Session 事件。

外部 signal 与 Session disposal 联合中止请求；等待异步 provider 建立、流式事件和最终结果均可取消，即使 provider 自身不结束。结束迭代会取消未完成的侧请求。空问题拒绝、空回答及 provider 错误向调用方报告。主 run 使用独立 controller。

TUI ④ 层持有请求与本地回答状态，③ 层 `SideQuestionPanel` 只收 props，展示问题、滚动回答、错误、等待与中英提示；Esc 关闭/中止，再发 `/btw` 替换前一请求并丢弃其晚到更新。pane 不进 transcript；原待答交互保持 FIFO，关闭后恢复。40×12 压缩输入并给侧问、状态与已有 dock 留出空间。`controlledModel.sideQuestions` 独立于 main/review/title 队列，保留标题优先识别。

验证：Core 公共 `createSession` / `sideQuestion` 7 tests / 52 assertions，TUI 公共 `start()` 4 tests / 27 assertions，覆盖快照恢复、工具过滤、hooks/reminder/events/transcript 隔离、取消与 disposal、run 并发、替换、空参数、错误、40×12 与待答面板恢复。受影响回归含 title/model/compaction/main/slash/settings/question parity：145 pass / 0 fail / 844 assertions。`oxfmt --check`、`oxlint`、`tsc -b`、`knip` 通过；完整 spec 的最终整合 full check 由交付阶段完成。

合入最新 context report 整合分支后，包含报告的回归 159 pass / 0 fail / 954 assertions，静态检查再次通过。`CONTEXT.md` 同步批准 spec 中 Side Question、Context Report 与手动 Compaction 的领域定义。

合入 session list / resume picker 的最新整合分支后，保留 live reader 注册和 disposal 注销，同时保留独立 side lifetime。新增第 5 个 TUI 用例验证 40×12 中 `/resume` 关闭/取消侧问再恢复原 session，侧问内容不进入恢复后的上下文。组合 side/list/run/resume 回归 36 pass / 0 fail / 213 assertions，格式、lint、types、knip 再次通过。
