# 03: 原生 JSONL、documents、上下文与 Rewind

Status: resolved
Blocked by: none

## What to build

把 Session Store、状态与上下文接入原生 durable Storage。建立新目录/索引、单宿主访问、fsync 和持久化身份；按能力声明 document 历史与 fork 策略。迁移 Transcript 投影、reminders、Compaction、Checkpoint/Rewind 和文件基线事务，不再读取旧 session repo 或旧 Tool State 消息。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [x] 新建、枚举、按 id 打开仅消费新目录及索引；旧 Session 文件保持原样且不进入 picker，旧 id 返回明确失败，不执行自动导入/升级。
- [x] 原生 JSONL sidecars、父子 ownership 与索引可跨 close/reopen恢复，启用 fsync；重复进程打开同一 storage 被宿主拒绝，失效持有者可恢复，不存在误删活持有者的清理。
- [x] Typed documents 覆盖 Todo、Goal facts、Plan Mode、模型选择、子代理、Checkpoint 和文件跟踪；清空、版本校验、坏状态处理及 latest/rewindable/fork 策略有明确行为。
- [x] 原生 reset/fork/Compaction 和状态 reminders 构造可恢复模型上下文；保留完整历史并区分当前上下文，提醒去重不依赖旧 Branch API。
- [x] 文件变更提醒与基线/删除事实原子提交，提交失败不推进模型已知状态、不发布成功事件；Resume 要求重读的保守行为保留。
- [x] Checkpoint 保留真实输入锚点、授权后首次 write/edit 备份与父级归属；Rewind 原历史保留、documents 恢复，文件恢复失败不切换对话。
- [x] 父子有活跃工作时拒绝 Rewind；恢复位置不复制后来的 task/Goal/subagent 活动，原历史中的图片与消息仍可观察。
- [x] 列表、预览和只读查询不启动模型或原生 scheduler；存储失败、退出与关闭有有界收束，原生 storage 资源不跨调用泄漏。

## Testing Decisions

优先经 createSession 验证 reopen、Compaction、documents、模型请求内容、文件副作用和 Rewind；沿用 checkpoint、checkpoint-subagents、文件变更与恢复 prior art。真实提交失败通过受控 Storage 故障注入并观察公开错误与重新打开状态，不写镜像内部快照测试。跨进程独占使用真实第二进程和退出信号。

## Verification

实施分支基于 02 独立集成提交 `d3e15957`。实现提交 `df9ad909` 已经独立审阅并合并为 `b113553f`；八项验收的公开证据、实际 diff 与 ADR coverage 一致，状态 resolved。没有运行 package 或 aggregate 测试。

### Acceptance evidence

| AC                              | 当前公开行为证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 新目录与身份                  | `session-list.test.ts` 覆盖新索引、模型选择、父级枚举、MemoryStorage、路径一致性，旧目录字节不变且旧 id 明确拒绝。                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2 JSONL、ownership、fsync、独占 | `session-store-ownership.test.ts` 经真实第二进程验证活跃拒绝、SIGKILL、同时恢复者只有一名获租约、第三进程拒绝和关闭后再开，租约 inode 保留。实际 EXCLUSIVE RED 出现零获租约者：两名同步恢复者均拒绝；改为 IMMEDIATE 单写者租约后，五次 bounded 场景均恰好一名成功，其余打开被拒绝。`jsonl-fsync.test.ts` 用实际生产 filesystem adapter 和原生 Storage 验证 sidecar/main flush、失败确认、poisoned 后必须重开；完整追加可在冷打开后恢复，即使调用方没有收到确认。父子共同存储与关闭恢复由 Checkpoint 子代理及恢复用例覆盖。 |
| 3 typed documents               | `document-recovery.test.ts` 对 Checkpoint、Directory 的坏 schema／较新版本经原生 typed tx 写入，重复打开拒绝、无模型调用、租约释放，修复后重开；坏新索引也拒绝列表／打开且不改写 journal。Todo 清空及坏状态、Goal pause/clear/坏状态、Plan 拒绝提交／版本／Rewind 和模型选择由 owner focused cases 覆盖。实际历史和 fork 策略维护在 Agent README。                                                                                                                                                                         |
| 4 当前上下文与完整历史          | `native-context.test.ts` 验证 reset handoff、当前 head 排除旧消息、owner document 与原 entries 保存及冷恢复。Compaction 用例保留完整旧 Transcript 前缀、chronological notice 和冷恢复，同时排除首次旧 prompt 与确切 Read callId；保留尾部再次出现的相同证据仍可见。Todo／独立来源提醒去重和冷恢复用例通过。                                                                                                                                                                                                                |
| 5 文件知识原子性                | `file-changes.test.ts` 原生 Storage commit observer 验证修改和删除提醒 entry 与 file-tracking document 在同一成功提交。实际拒绝提交及冷恢复用例保持 stale guard、阻止覆盖未获知的变化；未确认提醒不推进模型知识。                                                                                                                                                                                                                                                                                                          |
| 6 Checkpoint、文件恢复          | 全部 Checkpoint 与 checkpoint-subagents 用例验证真实锚点、授权后首份最终路径备份、父级共享归属、拒绝／bash 无备份、缺少备份的 preflight、成功恢复后发布。新增真实目标目录碰撞的 I/O 失败用例验证不切换消息或 Checkpoints、不发替换快照，冷恢复相同。                                                                                                                                                                                                                                                                       |
| 7 活动与原历史                  | Checkpoint 拒绝活跃父 Run 和后台子工作；身份 Rewind 与 Goal earlier facts 用例验证不恢复后来任务或自动激活。新增图像 Rewind 用例保留原 entry 和冷历史／模型图像，丢弃后来的 prompt／reply。Goal 进一步执行策略由后续 07 票验收。                                                                                                                                                                                                                                                                                           |
| 8 只读与收束                    | 冷未完成 unsafe child 真实进程 fixture 的独立列表查询保持全部原生文件字节一致，不调度或重放，父级索引正常；torn storage 拒绝修复。失败打开可重复拒绝后修复重开，Session close 的 observer 和实际 Hook 预算用例通过。列表资源在 open／close 失败时也走 owning finally。                                                                                                                                                                                                                                                     |

### Commands and results

命令均从实施 worktree 根执行并带 `rtk proxy`；下列是实际 focused 结果。

- `env -u NO_COLOR bun test packages/agent/tests/store packages/agent/tests/e2e/session-store-ownership.test.ts packages/agent/tests/e2e/document-recovery.test.ts packages/agent/tests/e2e/session-list.test.ts packages/agent/tests/e2e/checkpoint.test.ts`：43 PASS、262 assertions、4.15s，exit 0。随后 fsync 用例补充 poisoned snapshot／冷恢复边界：1 PASS、8 assertions、55ms，exit 0。
- `env -u NO_COLOR bun test packages/agent/tests/e2e/session-store-ownership.test.ts --test-name-pattern 'crash contenders' --rerun-each 5`：5 PASS、105 assertions、3.77s，exit 0；用于验证已经重现的竞争修复，未进行无界重试。
- `env -u NO_COLOR bun test packages/agent/tests/e2e/file-changes.test.ts --test-name-pattern 'share their native commit|rejected detection|snapshot saved before|failed committed-read baseline|malformed native|cold conversation rewind'`：6 PASS、26 assertions、607ms，exit 0。
- `env -u NO_COLOR bun test packages/agent/tests/e2e/compaction.test.ts packages/agent/tests/e2e/todo-reminders.test.ts packages/agent/tests/e2e/reminders.test.ts --test-name-pattern 'without deleting historical evidence|after cold reopen|additional sources|resumed Run|current Todo List|after each Compaction'`：8 PASS、64 assertions、1.044s，exit 0；Compaction 历史／当前 Read 排除断言追加后单例 1 PASS、18 assertions、273ms，exit 0。
- `env -u NO_COLOR bun test packages/agent/tests/e2e/goal.test.ts packages/agent/tests/e2e/plan-mode.test.ts packages/agent/tests/e2e/todo.test.ts --test-name-pattern 'resume restores an active Goal|forked children|pause|clear|malformed|unsupported native Plan|rewind restores Plan|child continued after a parent rewind|a rejected native Plan'`：22 PASS、96 assertions、1.319s，exit 0。
- `env -u NO_COLOR bun test packages/agent/tests/e2e/checkpoint-subagents.test.ts packages/agent/tests/e2e/session-dispose.test.ts`：22 PASS、109 assertions、3.44s，exit 0。真实进程 Hook shutdown budget 属于必要 integration 等待，不用固定 sleep。
- `bun run check:dev`：exit 0，包含 formatting、lint、types、Knip、scratch tracker、docs 与 ink boundaries。新 subprocess worker 是实际进程入口，已加入对应 Knip workspace entry。

Fsync adapter 提取保留了 02 的已交付 flush 行为；RED 验证的是直接使用上游 NodeExecutionEnv 的 main flush 缺口，未宣称旧生产实现漏 flush。运行证据来自 macOS；Linux／Windows 内核租约未在本机验证，SIGKILL 与 filesystem error 也不证明断电持久性。

### ADR coverage

沿用 ADR-0024 的原生 JSONL／documents／fork／单宿主决定，IMMEDIATE 是实现该独占义务的内核机制，无新领域政策；ADR-0003 的旧 repo 接口由 0024 部分替代。ADR-0016 的能力事实归属与完整 Transcript／当前上下文区别、ADR-0017 的真实锚点与文件范围、ADR-0020 的基线／提醒事务继续适用，更新 CONTEXT、架构和 Agent README 中相应当前契约。ADR-0009 的身份／Outcome 区别继续适用，04–07 的执行与恢复验收未被本票替代。未新增 ADR；历史 main branch 文字保留在旧 ADR 决定内并链接当前契约。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-08：02 已独立集成于 d3e15957；03 在 `codex/pi-durable-03-storage-context` 认领实施，公开验收与 focused 验证进行中。

2026-10-08：独立 merger 核对全部八项 AC、原生 Storage／内核租约／metadata 变更及公开测试，确认 evidence 与最终实现一致；集成 `b113553f`，文档／tracker／格式／diff 检查通过。沿用上述 ADR，无新增取舍；保留 macOS、断电与后续执行票的验证限制。03 resolved，04 可从当前集成基线认领。
