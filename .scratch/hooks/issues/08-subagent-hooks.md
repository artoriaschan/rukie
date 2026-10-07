# 08: 子代理 hooks

**What to build:** 子代理开始和结束时有 hook，结束时可以让子代理继续；子代理类型可以在 frontmatter 里声明只在自己运行时生效的 hooks。见 [spec](../spec.md)「接入：子代理」。

Blocked by: 01, 06

Status: resolved

- [x] 子代理内工具类 hook 输入带 `agent_id`、`agent_type`。
- [x] SubagentStart 在子 session 每次开始 run 前触发（含 `send_message` 唤醒），matcher 匹配 `agent_type`；`additionalContext` 附在子代理该次 user 消息上；不能阻断。
- [x] SubagentStop 挂子 session 的 run 层，语义同 Stop（block 续跑、上限 8），输入另带 `agent_transcript_path`、`last_assistant_message`；父 session 在子代理真正结束后才收到通知。
- [x] `agents/*.md` frontmatter 可声明 `hooks`（格式同 settings），`Stop` 改为 `SubagentStop`，只在该子 session 内生效；项目层目录的类型在非 trusted 时丢弃 hooks 并告警。
- [x] Agent Core e2e 与 config / 子代理类型测试覆盖以上。

## Delivery evidence

- 子 session 每次 run 触发 SubagentStart，包括 `send_message` 唤醒；matcher 使用 `agent_type`，context 附在该次 user 上。普通 block / exit 2 不阻断，通用 `continue:false` 优先结束 child run 并显示 stopReason，不写被停止的 prompt、不调 child 模型，随后仍可唤醒。
- SubagentStop 复用 run 收尾循环，支持 JSON block / exit 2 续跑、8 次上限、第 9 次告警与新 run 预算重置；父 session 只收到真正完成的 closing message。输入含 agent 身份、agent transcript path 与 last assistant message，反馈保留 `source: stop_hook`；取消反馈阻止下一模型调用。
- frontmatter hooks 复用 settings schema，Stop 转 SubagentStop，仅该 child 生效，与父 hooks 合并。项目三种 namespace 在非 trusted 时丢弃 hooks 并告警，其余类型字段保留；非法 hooks 有结构化诊断，TUI zh/en formatter 配套。
- `/implement` 与公共 e2e/config/type seams 按 RED → GREEN 执行。rebase main `7c9a6f324139792d9991b6012d33d658a5de979a` 后保留 issue 09 的 compact 下一 user context、continue:false 与取消契约。
- `/code-review` 双轴独立复审 implementation HEAD `c526981c3daf63fe1569cbefced7dc9d2d72c969`：Standards 0 findings（22 pass / 0 fail，277 expect），Spec 0 findings（62 pass / 0 fail，304 expect）。初审 SubagentStart 通用控制 P2 已修复并复核；配置测试目录按 spec:228 的明确例外保留。
- 完整验证：fresh 临时 HOME，清除 `NO_COLOR`，`bun run check` exit 0；oxfmt、oxlint、`tsc -b`、Knip 与全部测试通过，**1300 pass / 0 fail，6932 expect，100 files，132.67s**。日志：`/tmp/neant-hooks-08-delivery-check.log`。
