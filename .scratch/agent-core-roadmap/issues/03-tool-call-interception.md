# 03: 地基 C：工具调用前后拦截点

Type: grilling
Status: open
Blocked by: None

## Question

工具调用前后插入逻辑的机制是什么形状？

现状：`beforeToolCall` 里写死了 Permission Mode 判定（含 auto-review，ADR-0007）。即将挂上来的：权限规则（bash 命令前缀 / 路径）、hooks（用户脚本）、checkpoint 写前快照、sandbox、可能的 plan mode 只读限制。

需定：

- 有序拦截器链还是固定阶段（规则 → hooks → 权限模式 → 快照 …）；顺序及谁能短路。
- 拦截器的结果类型（放行 / 拒绝+原因 / 改写参数 / 要求交互），与地基 A 的关系。
- after 阶段能做什么（改写结果、记录、触发 reminder）。
- 内置工具、MCP 工具、skill 是否走同一条链。
- 子代理验证场景：子代理沿用父 session 的 Permission Mode 与规则，还是独立配置；能否比父更宽。
