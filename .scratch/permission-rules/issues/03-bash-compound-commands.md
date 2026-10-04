# 03: bash 复合命令拆分

**What to build:** bash 规则能看穿复合命令。`git status && rm -rf x` 会命中 `bash(rm -rf *)` 的 deny；`git status | head` 只有两段都被 allow 时才自动放行；引号里的分隔符不拆；含 `$(`、反引号、`<(`、`>(`、`<<`，或引号不闭合的命令不参与 allow 匹配，交给 Permission Mode，但 deny 和 ask 照常对整串与各段匹配。

**Blocked by:** 02

**Status:** claimed

参考：[spec](../spec.md)「Permission Rule」中的 bash 复合命令；User Stories 9–13。

- [x] 一个只认单引号、双引号和反斜杠转义的 splitter，按 `&&`、`||`、`;`、`|`、`&`、换行拆段
- [x] 纯函数表驱动测试：各分隔符、引号内分隔符、转义、拆不准的写法、引号不闭合、allow 需要每段都命中、deny 和 ask 任一段命中即生效
- [x] e2e 至少一条：拼接命令中的危险段被 deny 拒绝
- [x] 设置示例或 `--help` 写明 bash 规则不是安全边界
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

- 2026-10-04：实现完成，独立 review 待执行，暂不标 resolved。Bash 文本拆分封装在 permissions/bash.ts；规则接缝维持 evaluator，其他工具与路径规则保持 issue 04 所属。普通 allow（含裸 bash / *）对每段匹配；复杂标记或未闭合引号跳过 allow，deny / ask 仍按整串和各段取最严。
- TDD：危险段识别 19 pass / 7 fail → 26 pass / 0 fail；逐段 allow 0 pass / 7 fail → 33 pass / 0 fail；复杂写法 12 pass / 9 fail → 47 pass / 0 fail。最终 focused 71 pass / 0 fail（3 files），tsc -b exit 0。
- 代码冻结后 `rtk proxy env -u NO_COLOR bun run check` exit 0：870 pass / 0 fail，5023 assertions，67 files（112.65s）；格式、lint、类型和 knip 均通过。设置示例及文本匹配边界见 docs/permission-rules.md。
