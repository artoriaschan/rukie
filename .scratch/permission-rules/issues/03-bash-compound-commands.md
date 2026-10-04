# 03: bash 复合命令拆分

**What to build:** bash 规则能看穿复合命令。`git status && rm -rf x` 会命中 `bash(rm -rf *)` 的 deny；`git status | head` 只有两段都被 allow 时才自动放行；引号里的分隔符不拆；含 `$(`、反引号、`<(`、`>(`、`<<`，或引号不闭合的命令不参与 allow 匹配，交给 Permission Mode，但 deny 和 ask 照常对整串与各段匹配。

**Blocked by:** 02

**Status:** ready-for-agent

参考：[spec](../spec.md)「Permission Rule」中的 bash 复合命令；User Stories 9–13。

- [ ] 一个只认单引号、双引号和反斜杠转义的 splitter，按 `&&`、`||`、`;`、`|`、`&`、换行拆段
- [ ] 纯函数表驱动测试：各分隔符、引号内分隔符、转义、拆不准的写法、引号不闭合、allow 需要每段都命中、deny 和 ask 任一段命中即生效
- [ ] e2e 至少一条：拼接命令中的危险段被 deny 拒绝
- [ ] 设置示例或 `--help` 写明 bash 规则不是安全边界
- [ ] `tsc -b` 与全量 `bun test` 通过
