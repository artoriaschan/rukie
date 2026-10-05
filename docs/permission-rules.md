# 权限规则

Permission Rule 按 `deny` → `ask` → `allow` 的顺序匹配。显式 `deny` / `ask` 在所有 Permission Mode 下生效；`full-access` 不会越过它们，显式 `ask` 也不交给 Permission Review。规则判断使用 Hook 改写后的参数。用户层与项目层合并，项目层 `allow` 只有在用户声明的 Trusted Project 中生效。

## Web fetch 域名规则

在 settings 中允许常用文档站、询问特定站点或拒绝某个域名：

```json
{
  "permissions": {
    "allow": ["web_fetch(domain:docs.python.org)", "web_fetch(domain:*.example.com)"],
    "ask": ["web_fetch(domain:review.example.com)"],
    "deny": ["web_fetch(domain:blocked.example.com)"]
  }
}
```

`domain:docs.python.org` 只匹配该主机；`domain:*.example.com` 匹配所有层级的子域，但不匹配 `example.com` 本身。匹配不区分大小写，忽略主机名结尾的点，与 URL 的协议、端口及路径无关。裸名 `web_fetch` 匹配所有 URL；specifier 只接受 `domain:<host>` 或 `domain:*.<suffix>`，完整 URL、路径、端口和其他 glob 形式在配置加载时被拒绝。

审批时选择「本 session 允许此域名」，Agent Core 创建 `web_fetch(domain:<当前 host>)` 的内存 allow 规则。同一域名其他页面免询问，其他域名仍单独判定；规则与父子 Session 共享，子代理审批经顶层 Frontend 转发。Session Resume 不恢复这些临时规则。跨源重定向要求模型以新 URL 再次调用工具，新域名重新经过权限判断。

Headless CLI 没有审批回调，默认拒绝 `web_fetch`。可在仓库根目录运行以下命令，显式授权指定域名；需要已配置的 provider 凭据：

```sh
bun apps/neant-cli/src/main.ts -p "Read https://docs.python.org/3/" --allow-tools 'web_fetch(domain:docs.python.org)'
```

`--permission-mode full-access` 也可放行未命中显式 `deny` / `ask` 的调用。域名规则和 Hook 都不能绕过 `web_fetch` 的公网地址检查，工具始终拒绝内网与其他非公网目标。

## Bash 命令规则

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
