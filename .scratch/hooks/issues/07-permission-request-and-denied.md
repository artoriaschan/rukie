# 07: PermissionRequest 与 PermissionDenied

**What to build:** 即将询问用户时 hook 可以代答；任何拒绝都能被 hook 记录，auto-review 误判时可以提示模型重试。见 [spec](../spec.md)「接入：权限判定链」。

Blocked by: 01

Status: resolved

- [x] PermissionRequest 在判定为 ask、进入交互阶段前触发（规则 / hook / Permission Mode / auto-review 产生的 ask 都算），输入带 `tool_name`、`tool_input`、`permission_suggestions`。
- [x] `behavior: "allow"`：可带 `updatedInput`（校验后改写并重新过规则，规则 deny / ask 仍生效）、`updatedPermissions`。
- [x] `updatedPermissions` 只认 session 级 `addRules`（allow，写入 session 内存规则）与 `setMode`；其他条目忽略并 `hook_warning`。
- [x] `behavior: "deny"`：`message` 作为拒绝原因，`interrupt: true` 中止 run；exit 2 忽略。
- [x] 无 hook 拍板时照常询问；Headless 下也触发，无 hook 拍板仍 deny。
- [x] PermissionDenied 在每次 `permission_denied` 时触发，输入带 `by`、`reason`，规则拒绝时带 `rule`；`retry: true` 仅对 `by: "review"` 在拒绝结果后附重试提示，其他忽略。
- [x] Agent Core e2e 覆盖代答 allow / deny、session 规则生效于后续调用、非 session destination 被忽略、interrupt、retry 仅 review 生效。

## Delivery evidence

- Implemented via `/implement` and public Agent Core e2e TDD in the independent `codex/hooks-07` worktree.
- PermissionRequest always rechecks deny / ask rules after allow, accepts validated rewrites, and applies only session allow rules / string Permission Mode updates. Related parent / child sessions share mode updates by reference.
- PermissionDenied records all denial sources; review-only retry appends feedback without reversing the denial. Interrupting decisions retain every denial reason and prevent allowed sibling tools from executing.
- PermissionRequest / PermissionDenied exit 2 ignores event-specific JSON decisions and updates while retaining common `continue: false` / `systemMessage` behavior. Ignored output uses the existing bilingual hook diagnostics.
- Independent Standards and Spec reviews rechecked `9f78f8992c71640fa13bf629d2481d47eff9f83b`: both reported zero remaining findings after three public regression fixes.
- Focused permission / PreToolUse / session grant checks: **104 pass, 0 fail** across four files.
- Fresh full `bun run check` with isolated temporary `HOME` and `NO_COLOR` removed: **1333 pass, 0 fail**, 7051 assertions across 101 files; formatting, lint, TypeScript and knip passed. Evidence: `/tmp/neant-hooks-07-delivery-check.log`.
