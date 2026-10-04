# Bash 权限规则示例

在 settings 中按命令文本配置规则：

```json
{
  "permissions": {
    "allow": ["bash(git status*)", "bash(head*)"],
    "ask": ["bash(git push*)"],
    "deny": ["bash(rm -rf *)"]
  }
}
```

`bash(pattern)` 对去掉首尾空白的命令文本做 glob 匹配，`*` 可以跨空格和斜杠。复合命令按引号外的 `&&`、`||`、`;`、`|`、`&` 和换行拆段；单引号、双引号和反斜杠保护的分隔符不会拆分。deny / ask 对整串和每段匹配，取最严结果（deny > ask > allow）；allow 必须覆盖每段。因此上述配置会放行 `git status | head`，拒绝 `git status && rm -rf x`。

裸工具规则（如 `bash` 或 `*`）覆盖该工具的所有简单命令段。包含 `$(`、反引号、`<(`、`>(`、`<<` 或未闭合引号的命令跳过 allow 匹配，继续由 Permission Mode 判定；deny / ask 仍匹配整串和拆出的段。检测这些复杂标记时不会区分引号或转义。

Bash 规则是文本匹配，不是安全边界，也不是完整的 shell 解析器或 sandbox。命令替换、变量、别名、脚本、重定向等 shell 行为无法由文本规则完整约束；跳过 allow 的复杂命令在 full-access 下仍可能被模式放行。
