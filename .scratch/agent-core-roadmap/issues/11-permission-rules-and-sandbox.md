# 11: 权限规则与 sandbox

Type: grilling
Status: open
Blocked by: 03, 05

## Question

"限制工具能做什么"的两层：权限规则（按 bash 命令前缀、文件路径放行 / 拒绝），以及 sandbox（OS 级写入隔离，优先级最低，可先只定接口位置）。

需定：规则语法与匹配（复合命令拆分）；allow / deny / ask 优先级及与 Permission Mode 的叠加；配置层级（项目级能否放宽，比照现有 `allowTools` 只允许项目收窄还是放宽）；审批对话框"本 session 一直允许"是否改为生成规则；sandbox 是否进本轮实现还是只预留地基 C 的挂点。
