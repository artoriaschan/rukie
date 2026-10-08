# 05: 自有工具、MCP、图片与 OS 资源适配

Status: resolved
Blocked by: none

## What to build

逐项完成现有能力对 durable tools/extensions 与环境的适配。保留自研 bash/Jobs、read 图片、文件跟踪、grep/glob、skills、web fetch、MCP 管理、Side Question、标题和 usage/context 报告；删除旧 runtime adapters 与私有输出采集依赖。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [x] 每个现有自有能力均有目标 runtime 对应和公开行为验证；没有因上游接口删除而隐藏能力，没有留空 execute 或第二套工具执行器。
- [x] 默认 unsafe replay 覆盖实际文件写入、bash、MCP 与其他副作用；只有具备稳定身份和重放证明的工具声明 safe，已有已提交 intent 不被当前配置强制扩成 safe。
- [x] 图片输入、steer 图片、read 图片的内容校验和原始块持久化保留；text-only 降级、模型切换和 Frontend metadata 剥离正确。
- [x] bash 前后台共用一条启动路径，超时转后台、输出截断、完整输出提示、退出码、取消和 job_* 游标/规则保持可用；旧 harness 私有文件路径全部移除。
- [x] 宿主 close 终止 OS 进程组并释放输出；Resume 不重建 Job、不重跑 bash，已结算工具生成的旧 Job 不显示为当前活动。
- [x] MCP 发现、当前能力、动态 refresh、工具错误、OAuth 取消/重连及用户/服务器身份凭据隔离仍成立，宿主关闭释放连接；升级版本不改项目凭据来源。
- [x] web fetch 的公网/重定向/授权/代理/取消边界和 skills/project instructions 保留；Side Question 不改主 Transcript，标题与用量可恢复。

## Testing Decisions

公开 Session 与实际文件/进程/本地 HTTP-MCP fixture 验证 retained capabilities，复用 jobs、job-api、图片、MCP OAuth lifecycle、skills、reminders 与 web fetch 套件。实际进程清理用 exit/资源信号；同进程限时逻辑用虚拟钟。大样本输出通过 owning module seam，小型 Session 例验证 wiring，不重复昂贵 e2e 设置。

## Verification

基线为独立合并的 04 `6bc92383`；05 独立 worktree 为 `/tmp/rukie-pi-durable-05`，分支 `codex/pi-durable-05`。自有生产能力已由 02–04 迁移到目标 runtime；本票新增实际崩溃验收和资源释放证明，更新能力文档，没有修改生产工具实现或引入第二套执行路径。独立 merger 已核对实现、日志与七项验收，状态为 resolved。

### Acceptance evidence

| AC  | 当前实现与公开验证                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `session/tools.ts` 和 `tools/builtin.ts` 装配原生 ToolRegistration；native-tools、file/remaining/truncated-tool-views、reminders 验证文件、read、grep/glob、工具显示和上下文。Goal、Todo、Plan、Subagent 的 document/Interaction 迁移沿用 02–04 已交付基础；06/07 更深的身份和激活崩溃义务仍保留。源审计未发现 pi-agent-core、旧 harness 私有输出依赖或空 execute。                                                                                                                                           |
| 2   | 当前 replay 声明仅 `subagent`、`subagent_fork` 为 safe，其他工具采用原生 unsafe 默认。新增 `tool-replay.test.ts` 分别执行真实 Bash 文件追加和父进程 HTTP MCP 计数副作用，在真实 ToolResult commit 前 SIGKILL；屏障通过公开 Storage.task 验证已提交的 execute / unsafe checkpoint。两次冷打开均保留未知结果，不再执行，计数/mtime 不变。MCP 当前 server 改为 readOnly/idempotent 提示后仍不重放旧 intent。已有 unknown-tool-outcomes 验证实际文件写入与当前规则下 safe 委派恢复；06 将单独验收更深的稳定身份。 |
| 3   | images、image-read-and-usage、model-switch 验证原始图片/name 恢复、带 Skill 的 queued steer、超限/非法块在 Run 前拒绝、read 按 magic 校验、text-only 降级、当前模型/保留子模型和 provider metadata 剥离。                                                                                                                                                                                                                                                                                                     |
| 4   | bash、background-jobs、job-api、job-notifications、bash-permission-rules 验证前台不可见、显式后台、超时 promotion、完整 spill 与 UTF-8 尾部、退出/取消、游标及规则。native-tools 的 2200 行输出验证 owning Bash/native Harness seam；自有 output-capture/Jobs 继续拥有 OS 输出，非旧 harness 输出采集。                                                                                                                                                                                                       |
| 5   | 新 settled Job 测试验证完成输出资源可读，close 后 spill 文件已移除，冷恢复没有 Job、没有模型调用且旧输出事实可读。Bash receipt-loss 测试证明不重启命令；background-jobs 验证已关闭输出的同组后代仍被 close 清理、脱离组的输出 drain 有界，bash 验证 SIGTERM 升级。真实 OS/子进程边界保留必要实时等待。                                                                                                                                                                                                        |
| 6   | MCP API/config/transport/OAuth/lifecycle/Goal、subagent-mcp-oauth、manager 验证当前声明、配置变化、动态 refresh、工具错误、精确 endpoint/headers 凭据隔离、取消/重连/close、子身份及首轮 Goal 当前能力。MCP receipt-loss 新测试验证真实远端副作用只执行一次。                                                                                                                                                                                                                                                 |
| 7   | web-fetch 四族及 HTML 测试验证公网地址、重定向、权限、代理、取消和内容边界；skills/reminders 验证信任、当前项目指令和诊断；Side Question 隔离/取消，title 并发与恢复，usage/report 模型与 compaction 计数均通过。                                                                                                                                                                                                                                                                                             |

### Commands and results

所有命令使用 `rtk proxy`，Bun 行为测试清除 `NO_COLOR`，退出码均为 0：

- `env -u NO_COLOR bun test` 指定 tool-replay、bash、background-jobs、job-api、job-notifications、images、image-read-and-usage、model-switch：121 pass / 0 fail，503 assertions，15.96 s。
- 指定 mcp、mcp-api、mcp-config、mcp-oauth、mcp-oauth-lifecycle、mcp-goal、subagent-mcp-oauth、mcp/manager：124 pass / 0 fail，561 assertions，6.84 s。
- 指定 web-fetch、web-fetch-permissions/proxy/redirects/html、skills、side-question、session-title、context-usage、context-report：194 pass / 0 fail，756 assertions，9.44 s。
- 指定 tools/native-tools、reminders、bash-permission-rules、file/remaining/truncated-tool-views、unknown-tool-outcomes：39 pass / 0 fail，188 assertions，3.70 s。
- 新增 spill 释放断言后重跑 tool-replay：3 pass / 0 fail，28 assertions，701 ms；Bash 约 240 ms、MCP 248 ms、settled Job 70 ms。实际崩溃与 HTTP/OS 边界不能由父进程虚拟钟代替。

这些相关集共 478 个用例，不是 package 或全仓 gate。新 fixture 最初出现的失败是选错工具回执、缺少 Bash 必填 description 或未连接计数回调，均在 fixture 验证阶段修正，未发现或宣称修复生产 Bash/MCP runtime 缺陷。原有失败 package 结果由 02 交付记录保留，本票未重跑或将 focused pass 冒充全仓通过；最终 aggregate 属于 09。

`bun run check:dev` 最终退出码 0：format、lint、全 workspace types、Knip、tracker、45 份维护 Markdown 和 ink import boundaries 全部通过。首次执行在新增 settled Job fixture 出现 3 个 TranscriptMessage.content 类型错误，改用 role-filter 收窄后重跑该静态命令通过；没有类型断言或生产修改。`git diff --check` 通过。完整命令输出在 worktree 外 `/tmp/pi-durable-05-{resources,mcp,capabilities,foundation,replay-final,check-dev,check-dev-final}.log`。

### ADR coverage

沿用 spec 的 ADR Coverage：ADR-0024 规定唯一原生引擎、unsafe intent 和 close/abort 区分；ADR-0010 的自有 Bash/OS Jobs、ADR-0019 用户凭据与服务器身份、ADR-0021 原始图片和 ADR-0022 公网边界继续成立。本票没有新增架构取舍。Agent README 与 MCP 参考已纠正过时的 Session dispose、每 Run 关闭 MCP 连接和授权需求被当作连接错误的描述；不会把历史路径误写为可恢复资源。长期架构/全仓文档一致性仍由 09 最终覆盖审阅。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-08 独立 merger 验收：review implementation `48c2f048` 对基线 `6bc92383` 的六文件 diff、真实 Storage.task execute/unsafe 屏障、SIGKILL 后两次冷打开和 MCP annotations 变化、Job spill close/history 边界；确认没有生产执行路径变更，初始 fixture 修正没有被误报为 runtime 修复。逐项核对 478 个 focused 用例及当前 check:dev 日志，接受七项 AC 与 ADR coverage；合并实现后单独关闭票据。集成后的 tracker、docs、受影响 Markdown format 和 diff 检查通过；未重跑 package 或 aggregate。06 的更深稳定身份／reporter 窗口与07 Goal 激活验收仍待各自交付。
