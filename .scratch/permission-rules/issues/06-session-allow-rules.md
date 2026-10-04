# 06: "本 session 允许"生成会话规则

**What to build:** 审批框的"本 session 允许"不再放行整个工具，改为生成一条更窄的会话级 allow 规则：bash 生成按字面匹配的精确整条命令；文件工具生成目标所在目录的 `/**`（glob / grep 的目标本身是目录时，取该目录）；其他工具生成裸工具名。`onPermissionAsk` 新增返回值 `allow-session`；`PermissionAskRequest` 带上 `sessionAllow: { kind, rule }`，TUI 据此显示"此命令 / 此目录 / 此工具"。追加规则后，Agent Core 重新判定挂起的 ask：命中新规则的放行，并通过 signal 让 frontend 把它移出队列。会话规则只存在内存里，越不过 deny 和 ask 规则，resume 后失效。TUI 删掉自己维护的已放行集合。

**Blocked by:** 03, 04, 05

**Status:** ready-for-agent

参考：[spec](../spec.md)「"本 session 允许"」；User Stories 30–35。

- [ ] e2e：`allow-session` 生成的规则对后续同类调用生效；越不过 deny；resume 后失效
- [ ] e2e：命令含 `*` 时按字面匹配，不会变成前缀放行
- [ ] e2e：多个并发的同类 ask 中，回复一个 `allow-session` 后，其余被重判放行；不同命令或目录的请求继续等待
- [ ] TUI 测试：三种按钮文案按 `sessionAllow.kind` 显示（i18n）；选中后回复 `allow-session`；被撤销的请求从队列移除；auto-review 下不显示该按钮
- [ ] `tsc -b` 与全量 `bun test` 通过
