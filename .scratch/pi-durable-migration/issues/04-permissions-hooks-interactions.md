# 04: 权限、Hook 协议与中断交互恢复

Status: claimed
Blocked by: none

## What to build

将 Permission Decision/Review、Trusted Project、Claude Code Hook 协议及 Interaction 接入原生工具与 generation 生命周期。设计最小宿主扩展保存请求阶段并恢复未完成交互，使用当前配置重新判定，失效进程内回调不能影响恢复后的任务。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [x] 工具先校验输入，再按现有 Hook/显式权限规则/模式/Frontend 判定执行；Hook allow 越不过 deny，改写后的参数仍重新授权。
- [x] 当前项目信任、用户与项目配置边界和 Permission Review 失败转 ask 保留；恢复后的 safe 工具也不得跳过当前规则。
- [x] 权限、问题、Plan Review 与 MCP OAuth 的未完成请求有可恢复的身份/阶段；close/reopen 后重新判定并重新发起，不把关闭保存为批准/拒绝或业务工具成功。
- [x] 临时 allow 不恢复，旧 callback 晚到无效；显式拒绝/abort 后任务不因重开又恢复等待同一被取消请求。
- [x] Headless 缺少回调时依赖交互的工具隐藏，Core 发起的请求取安全默认，不等待不可达 Frontend。
- [x] Claude Code Hook 事件、输入、输出、取消、Stop 继续与日志语义对应 durable 生命周期；外部 Hook 副作用不自动声明 replay-safe，不承诺重启下 exactly-once。
- [x] Plan Mode 独立于权限，不采用上游示例的强制只读模式；父子共享规划状态和来源转发/排队行为保留。

## Testing Decisions

公开 Session 测试覆盖交互挂起时 close、规则/信任变更后 reopen、旧回复晚到、deny、safe replay 当前授权以及无 callback。复用 permission-hooks、rules、paths、review、async-hooks、Plan Mode 与 MCP OAuth fixtures。用屏障控制阶段，避免 sleep 和人为加大 timeout。真实 Hook 进程取消沿用当前 post-tool-hooks 的原子 ready-file/两个 PID 发布与 filesystem completion 信号，验证 shell 和子进程均已启动后再收束；不要恢复旧固定轮询等待。

## Verification

04 实现已完成，待独立 merger 审核；Status 保持 claimed。公开 createSession tracer 分别复现 Question（101ms）、Plan Review（100ms）、Permission 身份（83ms）和 OAuth（105ms）旧行为 RED，当前实现 GREEN。native Task memo 仅保存 kind-scoped 请求身份／pending，native call/execute/terminal phase 决定恢复；回复、epoch 和临时授权仅属当前 invocation。OAuth 沿用同一 flow，真实 HTTP／Storage commit 证明 token exchange 发生于 unsafe execute 意图之后；该边界后 close 留下真实 outcomeUnknown，不重发 code。

当前 focused interaction matrix（questions、plan-review、permissions、permission-review、permission-hooks、subagent-permissions、permissions/batch、mcp-oauth、subagent-mcp-oauth、mcp-oauth-lifecycle）：193 PASS、731 assertions、10.16s。覆盖 pending close/reopen、明确 abort 冷恢复不重问、旧 callback 和 HTTP state 失效、用户撤销项目信任、当前 endpoint／deny／safe replay 重新授权、Headless 默认及 child origin。相关 Hook／Plan／rules／unknown-outcome 八文件首次 132 PASS／1 FAIL（仅 MCP／skill 并行 denial 顺序断言）；改为精确排序集合后该例 1 PASS／3 assertions／245ms。其余 132 例包括 Hook 协议、Stop 继续、子代理 Hook、真实 ready-file／PID 进程清理，均通过。

TUI Question／Plan Review／OAuth／child Interaction／FIFO 五文件首次 64 PASS／1 FAIL，揭示 identity memo yield 与 sibling session grant 的真实竞态；权限能力将 memo await 放到 listener 安装前并重新判定 current grant，保留原 FIFO 断言后公开 reproducer GREEN（529ms）。后续本地复验结果见 Comments。`bun run check:dev` 在模块 ownership／epoch guard 修正后 exit 0；最终新增局部修正后再次 `bun run check:dev` exit 0（types／lint／Knip／format／tracker／docs／ink boundaries）；`git diff --check` 通过。未运行 package 或 aggregate；最终统一 gate 由总集成负责，历史失败结果未被 focused 通过替代。

ADR coverage：ADR-0024 已规定 native 生命周期、pending 恢复与 close/abort 分离；本实现具体化其宿主 preflight，不改变决策。ADR-0011 的能力归属落实为 owning Question／Plan／MCP preflight，generic Interaction 只持有身份与 callback 等待。ADR-0014／0015 保留 Hook 协议与权限阶段，ADR-0019 保留 Plan Mode 独立与父子共享；ADR-0009 的 unsafe 未知结果不自动重放。无需新增 ADR；Agent README 与 MCP 文档同步了稳定身份、fresh callback、当前 trust/config 和 unsafe exchange 边界。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-08：03 独立集成并 resolved 于 `1a47e87a`；04 在 `codex/pi-durable-04-interactions` 从该精确基线认领。按已确认的公开 createSession／原生 Storage fault seams 逐个 red→green，设计笔记位于 `/tmp/pi-durable-ticket04-acceptance.md`。

2026-10-08：Plan Review pending close/reopen 实际 RED（replacement 未调用，100ms）后迁移 capability preflight，整个工具仍 unsafe；旧 approve 不能退出规划，新 revise 与稳定 native 请求身份／fresh epoch 可见。Permission 身份 tracer RED（83ms）后共用 kind-scoped native memo；旧 allow-session 晚到无效，冷 current deny 不问 Frontend 且留下真实 typed rule denial。相关 permissions／plan-review／permission-hooks／subagent-permissions／native batch：94 PASS、331 assertions、5.23s。Question 受影响两例 2 PASS／12 assertions／273ms；TUI FIFO 1 PASS／8 assertions／118ms。全仓 tsc 和影响文件 lint 通过；OAuth 新 pending 恢复仍未实施。

2026-10-08：OAuth pending close/reopen tracer RED（105ms）后把原有单一 flow 停在 signal-bound beforeExchange，原生 unsafe execute 意图之后才释放；只对 live call-phase 的 validated kind-scoped memo 加载当前 MCP 声明再 resume，无历史自动登录。新 listener/state/verifier 不沿用旧 callback，保留精确 endpoint 归属。真实 HTTP + public Storage commit 证明 native intent 前 token 请求为零，进入 exchange 后 close 冷恢复留下 outcomeUnknown、不重发 code。当前 endpoint 变化与 Headless 冷恢复同样通过。四个新用例 4 PASS／27 assertions／433ms；原 mcp-oauth + subagent-mcp-oauth 25 PASS／119 assertions／1.91s（新增边界前测得）。尚待完整相关 focused 验证与文档／静态检查，无 package/aggregate。

2026-10-08：包含新边界用例的 mcp-oauth／subagent-mcp-oauth／mcp-oauth-lifecycle 三文件 43 PASS、202 assertions、3.30s，exit 0；`bun run check:dev` 完整静态／tracker／docs／ink boundaries exit 0。公开文档补充 pending 请求身份、close/abort 区别及 OAuth unsafe exchange 边界；未运行 package/aggregate。

2026-10-08：最终 epoch／signal ownership guards 与 capability boundary 调整后 interaction matrix 193 PASS／731 assertions／10.16s。修复身份 memo yield 的 session-grant 竞态后 permissions／permission-review／permission-hooks／subagent-permissions／native batch 107 PASS／383 assertions／5.91s；TUI Question／Plan Review／OAuth／child Interaction／FIFO 65 PASS／190 assertions／9.56s。Hooks 并行 denial 消费者按精确集合断言，原效应阻止与 typed provenance 断言保留。当前 integration `1a47e87a` merge 已 up to date；无 package／aggregate。
