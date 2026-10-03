# 06: 子代理

Type: grilling
Status: open
Blocked by: 01, 02, 03, 04

## Question

子代理在 Neant 里是什么、Agent Core 如何提供？

地基 A/B/C 已各自定下子代理的交互转发、transcript 存储、权限继承；本工单在此之上定：

- 领域定义（入 `CONTEXT.md`）：子代理与 Session / Run 的关系。
- 模型工具 schema；预定义子代理类型（类似 Explore）是否需要、如何配置（文件格式与加载位置，比照 skills）。
- 上下文隔离：系统提示、工具集、是否继承父历史；结果返回形态。
- 并发：同一 turn 多个子代理并行；取消传播；嵌套深度。
- TUI 呈现与 Headless CLI stream-json 事件。
