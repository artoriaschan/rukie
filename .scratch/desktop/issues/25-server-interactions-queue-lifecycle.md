# 25: server 权限 Interaction、Queued Input 与 Session 生命周期

**What to build:** 在 24 的基础上补齐权限桥接与补发、Queued Input 命令、模型与模式切换、置顶与偏好，以及空闲关闭与 SIGTERM 关闭。见 [spec](../spec.md) 的「server」「wire 协议与鉴权」。

Blocked by: 22, 24

Status: ready-for-agent

- [ ] `onPermissionAsk` 桥接：`interaction_requested` 带 identity 与去掉 `signal` 的负载；`interaction.reply` 按 epoch 结算，epoch 不符返回 `interaction_stale`；取消或被规则覆盖时发 `interaction_settled`
- [ ] 订阅时补发挂起的 Interaction；新连接接管后补发给新连接
- [ ] Run 进行中的 `prompt` 成为 Queued Input 并返回 `requestId`；`steer_now`、`withdraw`（`not_queued`）、`abort` 交还原文与附件
- [ ] `models.list`、`session.set_model`、`session.set_permission_mode`、`session.pin`/`unpin`、`preferences.set` 写入注册表并广播 `sessions_changed`
- [ ] 有 Run、挂起 Interaction、Queued Input 或运行中 Background Job 时不关闭；空闲且无订阅超过 10 分钟 `close()` 释放 lease（虚拟时钟验证截止前与截止时）
- [ ] SIGTERM 关闭全部 Session 后退出，Background Job 进程组被清理
- [ ] 接缝同 24
