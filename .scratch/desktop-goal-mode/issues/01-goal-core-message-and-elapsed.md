# 01：Goal 目标消息、附件与已执行时间

Status: claimed

**What to build:** 按 [spec](../spec.md) 的「Agent Core」与「TUI 与 headless」两节，让 `createGoal` 把目标写成可见的人类用户消息（可带图片、可只发图片），并在 Goal Tool State 中持久化已执行时间。

- [x] `createGoal(objective, { images?, maxRounds? })`：在同一个请求中写入人类来源的目标消息（文本加图片），作为第 1 轮输入并计入 `roundsStarted`；第 2 轮起使用 `<goal_round>`；图片沿用 `validateImage`
- [x] 文本与图片至少一项；`objective` 允许为空
- [x] Goal Tool State 升级到 version 2：`attachments`、`elapsedMs`、`activeSince?`，`parse` 校验 `activeSince` 只在 armed 时存在
- [x] 已执行时间的结算点：暂停、受阻、停止、出错、完成、清除、轮次用尽、每轮结束；恢复时如果推进没有继续，丢弃未结算的段；Fork 清空 `activeSince`；Rewind 恢复当时的值
- [x] `objective` 为空时，`<goal_round>` 与 reminder 改为引用目标消息中的附件并给出数量；按 ADR-0046 更新模型指引
- [x] 非完全访问时，`warn` 文案改为建议完全访问
- [x] TUI `/goal` 与 headless `--goal` 的对话展示目标用户消息；更新它们的测试断言
- [x] 更新 CONTEXT.md 中的 Goal 条目、ADR-0018（见 spec 的 ADR Coverage）、`packages/agent/README.md#goal-continuation`
- [ ] 测试：带图片、只发图片、文本和图片都为空时拒绝；虚拟时钟验证时长的各个结算点；恢复、Fork、Rewind；权限提示文案；`bun run test:agent` 与受影响的 coding-agent 测试

## Comments

### 实施与验证（01）

- 分支 `feat/desktop-goal-core` 从集成分支 `cc0c3b44` 建立，交付前快进合入 `b82caf66`；未修改其他票据或 spec 状态。
- Goal v2：目标用户消息可带图片或仅图片；首轮按 Goal 身份计数，同时沿用人类消息的 Hook、标题和 Checkpoint；模型 `create_goal` 保持文本与内部续跑路径。
- `elapsedMs` 在轮次、暂停、受阻、停止、出错、完成、清除和上限结算；恢复丢弃旧活动段，Fork 复制已结算时长且清空活动段，Rewind 恢复历史时长。首条目标消息保存创建前 Goal 事实，重开 Session 后回退该消息也会恢复空值或旧 complete Goal，不遗留失去附件的目标。
- 被动 `readSessionSnapshot` 投影 `armed: false` 并省略 `activeSince`，不改写运行宿主；实时状态仍由拥有 Session 的宿主订阅。
- 同步 CONTEXT、ADR-0018、Agent README 与 architecture；Goal reminder 的图片目标指引仍按 ADR-0046 位于 Goal 能力。
- TDD：带图用户消息、UserPromptSubmit 阻止、被动快照、首目标 Rewind 均保留 red/green 证据。虚拟注入 `now` 验证墙钟时间，无固定等待。新测试 fixture 统一关闭拥有的 Sessions 后清理目录，挂起回复响应 abort。
- 受影响 Core 初步集合 41 pass；TUI/headless Goal 集合 22 pass。coding 4 文件集合 88 pass/1 fail：E2E readiness 自动推进虚拟时间使“新目标恰为 0s”断言无效，改由现有组件测试继续精确验证 999ms/1000ms、重置与冻结；E2E 改为验证新目标和轮次，该例 focused 通过。
- 必需 `bun run test:agent` **失败**：1812 pass、18 fail、15 errors，263.47s；17 个默认 5s 超时横跨 Goal、Todo、Compaction、文件与子代理，一个 PreCompact 20ms deadline 得到 timeout 而非 exit。未扩大 timeout，未把 focused 通过算作包级成功。
- 顺序分组 Goal 集合 71 pass/1 个 crash/reopen 5s 超时；该 crash、暂停与被动快照最小组合 3 pass。未修改的失败族最小组合 20 pass。后续加入 Rewind 与被动消费者的 4 文件集合 46 pass/4 个 5s 超时/1 个关闭后错误；所有 21 个 desktop SQLite/output 用例通过。不能从这些结果断言包级失败已解决或原有缺陷。
- 对首次 reporter 超时加临时阶段/commit 诊断后精确运行一次：558ms 通过；Session 建立 66ms、Human Run 返回 303ms、child/round barrier 382ms、report queued 393ms、Request 结算 535ms、清理 557ms；76 次持久化 commit 累计 204.9ms、最大 17.7ms。诊断未复现挂起，不能证明此前分组超时原因；临时插桩已移除。
- scoped `tsc -b packages/agent packages/coding-agent`、lint、格式、`docs:update`、`check:docs`（155 Markdown）通过；最终 aggregate static/full acceptance 由协调代理统一执行，本票保持 claimed 等待该门禁与评审。
- 完整历史、命令、耗时与日志：`/tmp/rukie-desktop-goal-mode-evidence/verification.md`，失败日志保留原名，后续通过不覆盖失败事实。

- 补充 SQLite 图片持久化 red/green：Goal driver 初始图片补原生 `type: image` 标记，复用既有外部附件映射；关闭后数据库不含 base64，只有一份外部图片，历史读取与恢复后的模型上下文均保留图片和名称（1 pass、5 assertions）。

- 协调代理 canonical coding 消费者阶段发现 CLI E2E 遗漏的 `auto-review` 提示断言；新代理在独立分支修正为完整 `full-access` 建议，并精确断言第一轮模型输入包含目标用户消息。全文件 Goal 断言审计未发现 version 1 fixture 或其他过时合同。
- 一次串行 `cli.test.ts -t "goal|Goal"`：19 pass、5 fail、3 errors，55.19s；修正用例通过（2.832s，真实 CLI 子进程及 HTTP 传输）。其余失败均为未修改的恢复、拒绝、信号和 wrapup 用例 5s 超时，之前 canonical coding 中它们均通过；保留失败事实，不扩大 timeout、不重跑。canonical coding 本身仍为失败：1512 pass、32 fail、2 errors，787.98s。格式、scoped lint 与 diff 检查通过；本票继续 claimed 等待协调门禁与评审。
