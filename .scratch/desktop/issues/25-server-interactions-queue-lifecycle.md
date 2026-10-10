# 25: server 权限 Interaction、Queued Input 与 Session 生命周期

**What to build:** 在 24 的基础上补齐权限桥接与补发、Queued Input 命令、模型与模式切换、置顶与偏好，以及空闲关闭与 SIGTERM 关闭。见 [spec](../spec.md) 的「server」「wire 协议与鉴权」。

Blocked by: 22, 24

Status: claimed

- [x] `onPermissionAsk` 桥接：`interaction_requested` 带 identity 与去掉 `signal` 的负载；`interaction.reply` 按 epoch 结算，epoch 不符返回 `interaction_stale`；取消或被规则覆盖时发 `interaction_settled`
- [x] 订阅时补发挂起的 Interaction；新连接接管后补发给新连接
- [x] Run 进行中的 `prompt` 成为 Queued Input 并返回 `requestId`；`steer_now`、`withdraw`（`not_queued`）、`abort` 交还原文与附件
- [x] `models.list`、`session.set_model`、`session.set_permission_mode`、`session.pin`/`unpin`、`preferences.set` 写入注册表并广播 `sessions_changed`
- [x] 有 Run、挂起 Interaction、Queued Input 或运行中 Background Job 时不关闭；空闲且无订阅超过 10 分钟 `close()` 释放 lease（虚拟时钟验证截止前与截止时）
- [x] SIGTERM 关闭全部 Session 后退出，Background Job 进程组被清理
- [x] 接缝同 24

## Implementation evidence

- 实现分支 `feat/desktop-25`，基于 21–24 的 server / Session Queued Input API。每个工单使用新子代理，本工单没有复用其他 issue 的执行代理。
- WS 权限桥接按完整原生 identity 与 epoch 结算；signal 不进入 JSON。订阅在 snapshot 后重放 pending 请求，接管后新连接可重放；取消和会话规则覆盖都广播 settlement。
- 所有 schema 命令已接入。新建与 prompt 立即返回 requestId；withdraw / steer_now 的缺失队列返回 not_queued，abort 返回原文和附件。新建可在首条输入前选择 modelSelection / permissionMode。shared 拥有 own-message、模型目录和 preferences 的类型与 schema；首次连接和修改广播 sessions_changed，订阅及状态更新提供 session_state。
- Agent Core 的 run / followUp / 恢复中的 human admission 共用完成路径，使用原生 settled submission 的 answer 截止点提交单个 Run Summary；同一 Run 的 steer 合并不会重复 summary / result。waitForRequest 保留 Request Ledger 的子工作因果结算，并等待人类完成提交。
- 跨进程忙 Session 的订阅先发只读已提交快照再回 session_busy。readSessionSnapshot 由 Session 能力组合 store 的 readonlyFiles / native kernel，复用 Transcript、未知工具结果和 snapshot 投影；kernel / storage 都显式释放，不执行 Harness recovery、Hooks、模型或写入。已检查 pi-durable 1.0.4 JsonlStorage.open：recover 一次加载到私有 MemoryStorage，document / scanEntries 不重新读取磁盘，后续外部写入不会混合本次读帧。快照保留 Todo/Plan/Goal/子代理目录，别的进程的 Job 与子代理进程活动不重建。
- 无订阅的 idle deadline 为 10 分钟；Run、permission、queue、Job 和 native background child 都持有 Session。退休过程与 shutdown 被追踪，清理错误仍释放剩余资源。SIGTERM / SIGINT 使用生产 process 入口，先 abort 全部 Session，再释放 runtime / Session / Job 进程组。
- createdAt 来自 Session store 目录的文件系统 birthtime，和 updatedAt 独立；没有改变 JSONL 元数据格式，目录复制/重建会改变此时间。创建/更新两种排序的区别由公共 listSessions 用例验证。

## Verification evidence

- Red：real WS 在已有 Run 中发送 prompt 原先返回 session_busy，新增 requestId / withdraw 断言失败；models.list 的 fakeModel 目录断言原先失败。Green：对应 public WS 用例通过。
- `bun test packages/server/tests`：鉴权、连接接管、signal-free epoch、late reply、取消、规则覆盖、队列图片回填、模型/模式/注册表持久化、忙 lease 只读 bytes 不变，全部通过。
- 虚拟时钟验证空闲截止前仍持有 lease、截止时清理完成并释放 lease；Run+permission+queue、Background Job 和 native child 在超过截止时间后仍持有 lease。
- 真实 SIGTERM 用例启动生产 signal handler 的测试 sidecar 和 fakeModel，通过 FIFO 持有 OS Background Job；signal 后 exit 0、进程组死亡、Session lease 可重新打开。真实 OS process/signal 合约不能由父进程虚拟时钟代替。
- `bun test packages/agent/tests/e2e/queued-input.test.ts`：6 pass，含恢复队列的 summary、same-Run steering 单个 summary、idle followUp result / summary 和 reopen；waitForIdle / abort 等待 human completion，abort→close→resume summary 和恢复后首次订阅旧消息均有回归覆盖。聚焦测试中最慢者真实 SIGTERM 约 0.25–0.35 秒，恢复队列约 0.19 秒；其余新增测试低于 0.1 秒。
- 最终聚焦集（server、queue、Session list、permissions、child outcomes、store）68 pass / 8 files，约 4.05 秒；合并 `feat/desktop-mvp` 的 `7be87f48` 后 frozen install 和 check:dev 也通过。
- `bun run check:dev` 已通过（format / lint / types / Knip / tracker / docs / boundaries / test-policy / typography），`git diff --check` 通过。交付前对最终状态补做聚焦检查与静态检查；不在此子代理运行全套，根集成在 review 后因公共 Request completion / observation 变更运行一次 aggregate。
- 首次重构 cleanup helper 曾发生局部名称遮蔽，focused SIGTERM / close 用例捕获，已修正；遗留测试 FIFO 进程按实际 cwd / pgid 核实并清理。空闲 close 与 shutdown 的竞争由 retirement tracking 修正，截止验证按明确 closedSessionId completion 消息同步。

## ADR coverage

沿用 ADR-0030 的 Hono/Effect 边界、ADR-0031 的 native Interaction identity 和单 WS、ADR-0032 的 JSONL / registry 归属、ADR-0011 的能力所有权、ADR-0024 的原生 Harness / lease / recovery。新增只读访问只组合已安装 native kernel 读路径，不启动 recovery，不产生新的持久化格式或跨能力依赖，无需新 ADR。工单保持 claimed，等待独立 review 与根集成交付；不提前关闭 spec。
