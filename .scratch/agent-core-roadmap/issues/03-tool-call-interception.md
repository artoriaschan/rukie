# 03: 地基 C：工具调用前后拦截点

Type: grilling
Status: resolved
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

## Answer

2026-10-04 grilling 结论（`CONTEXT.md` 的 Permission Decision、Permission Mode 条目已同步）：

1. **形状：Agent Core 内部写死的固定阶段，不做开放拦截器链。** before 顺序为 hooks（可改写参数）→ 权限规则（按改写后的参数判）→ Permission Mode（ask / auto-review / full-access）→ 交互（地基 A）→ 放行后阶段 → 执行 → after。每个阶段是一个具名函数，不对外暴露注册 API。阶段顺序关乎安全（hook 的 allow 越不过规则的 deny），已知的使用方也都列得出来。代码由现在的 `beforeToolCall`（`session/index.ts`）拆出，放进 `permissions/`。plan mode 的只读限制作为规则阶段里的一组内置 deny。
2. **判定合成：** 每个阶段返回 `allow | deny(reason) | ask(reason) | 无意见`，取最严（deny > ask > allow）。没有阶段表态时交给 Permission Mode 给默认值。显式的 allow（规则、hook）跳过 ask 和 auto-review，作用等同现在的 `allowTools`。deny 的 reason 原样回给模型，`permission_denied` 事件加一个 `by: "rule" | "hook" | "user" | "review"` 字段。
3. **full-access 不跳过规则和 hooks：** 只把模式阶段的 ask 变成 allow，用户显式写下的 deny 规则和 hooks 照常执行。
4. **参数改写：** pi 0.99.2 的 `beforeToolCall` 不支持改写，但执行时用的是同一个 `args` 对象引用。做法是先用 schema 重新校验改写后的参数，再原地 `Object.assign`，并用一条测试钉住 pi 的这个引用行为。pi 升级破坏它时，改为在注册工具时包一层 `execute`，从以 toolCallId 为键的 Map 里取改写后的参数。
5. **after 阶段只给 hooks 用：** 可以替换结果（pi `afterToolCall` 支持逐字段覆盖）、把上下文作为 system reminder 附在这次 tool result 上、把 `isError` 设为 true。没有撤销语义，checkpoint 和记录都不放在 after。
6. **挂点：** 在"判定为 allow 之后、执行之前"预留一个只读的放行后阶段，供 checkpoint 选用（被拒的调用不留快照）；checkpoint 最终挂在逐次写前还是 turn 生命周期上，由 checkpoint 工单决定。sandbox 不进链，它属于 bash 工具的执行环境。
7. **子代理验证场景：** 子代理按引用共享父 session 的判定配置（Permission Mode、规则、hooks），父 session 切换模式时实时生效。子代理类型只能再收窄（工具白名单、追加 deny），不能放宽。ask 按地基 A 经顶层回调转发，并带上 `origin`；Headless 下 fail-closed。
8. **同链范围：** 内置工具、MCP 工具、`skill` 工具都走这条链（现状已经如此，三者都在 `agent.state.tools`）。用户在 prompt 里写 `/name` 展开的 Skill Invocation 不是工具调用，不经过这条链。

## Comments

- 2026-10-04：第 1 条中"plan mode 的只读限制作为规则阶段里的一组内置 deny"已被 [plan mode](10-plan-mode.md) 推翻：Plan Mode 只引导、不限制工具，权限判定链不变。
