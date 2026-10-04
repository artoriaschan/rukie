# 04: UserPromptSubmit 与 SessionStart

**What to build:** 用户提交 prompt 时 hook 可以拦下它或附加上下文；session 开始时 hook 可以注入项目状态。见 [spec](../spec.md)「接入：Session 生命周期」。

**Blocked by:** 01

**Status:** resolved

- [x] UserPromptSubmit 在写入 user 消息前触发，输入带 `prompt`，默认超时 30s。
- [x] `decision: "block"` 或 exit 2：不写 transcript、不调模型，run 以 `RunResult` 新分支 `hook_blocked`（带原因）结束；CLI 与 TUI 显示原因。
- [x] `additionalContext` 与纯文本 stdout 作为 system reminder 附在该 user 消息上。
- [x] Goal、子代理通知等 Agent Core 自己注入的 user 消息不触发。
- [x] SessionStart 在 `source` = startup / resume / fork 时触发一次，matcher 匹配 `source`，输入带 `model`；`additionalContext` 与纯文本 stdout 附在下一条 user 消息上；不能阻断。
- [x] Agent Core e2e 覆盖拦截、注入、resume / fork 的 source；CLI 测试 `hook_blocked` 输出。

## Delivery

- SessionStart 在 createSession 尾部执行一次；上下文保留到下一条被接受的 user 消息，被拦截的 prompt 不消费它。startup / resume / 真正 subagent_fork 来源经公开 Session e2e 验证。SessionStart 普通 block / exit 2 不阻断，通用 continue:false 按 spec 优先结束首个 run。
- UserPromptSubmit 在 transcript 写入前执行；Core 生成的 child prompt 与子代理结束通知绕过该事件。CLI text / stream-json 和 TUI 中英原因呈现均有公开测试。
- /code-review 固定基线 `9e2219eaf29a1745ddf01e8d60fe1f41ebbf5c91`：Standards 初审与复审均 0；Spec 初审 1 个 P2（纯文本仅含单边 JSON 分隔符时丢失上下文），先补 4 个 failing e2e，再修正 JSON 判断为首尾同时匹配；Spec 复审 0。复审独立重跑 prompt hooks：13 pass / 51 assertions。
- 最终代码 focused 检查：74 pass / 268 assertions；重复 `tsc -b` 通过。
- Fresh 全量 `bun run check` 使用临时 HOME 并移除 NO_COLOR，退出码 0：1243 pass / 0 fail / 6637 assertions，94 个测试文件；格式、lint、typecheck、Knip 同时通过。日志 `/tmp/neant-hooks-04-delivery-check.log`。
