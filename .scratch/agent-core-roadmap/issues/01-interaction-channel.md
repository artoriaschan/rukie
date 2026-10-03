# 01: 地基 A：Agent Core → frontend 交互通道

Type: grilling
Status: open
Blocked by: None

## Question

Agent Core 需要向 frontend 发起一次交互并等待回复的通用机制吗？形状是什么？

现状：审批走 `onPermissionAsk` 回调。即将新增的需求：ask user（模型向用户提问、TUI 弹选项）、plan mode 批准、MCP OAuth 授权、可能的 hooks 确认。

需定：

- 统一成一个交互通道（请求种类 + 载荷 + 回复），还是每种交互各一个回调。
- 取消与超时：用户 `esc`、run 中止时挂起的交互怎么结束。
- 交互请求与回复是否进 transcript（resume 时挂起的交互如何处理）。
- Headless CLI 的统一降级规则（拒绝 / 报错 / 按默认回复）。
- 子代理验证场景：子代理内发起的交互如何转发到顶层 frontend，用户如何知道是哪个子代理在问。
