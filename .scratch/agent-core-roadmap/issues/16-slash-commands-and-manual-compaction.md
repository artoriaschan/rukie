# 16: 自定义 Slash Command 与手动 compaction

Type: grilling
Status: open
Blocked by: None

## Question

Slash Command 已定属 frontend（`CONTEXT.md`），Agent Core 只暴露能力 API。本工单定：

- TUI 命令框架：内置命令清单（`/compact`、`/goal`、`/clear` …）、补全菜单、与 skills 的关系（skill 是否也能 `/` 调用）。
- 自定义命令：模板文件格式与加载位置（比照 skills 的用户级 / 项目级）、参数占位、由 Agent Core 加载还是 TUI 加载。
- 手动 compaction：Agent Core `compact()` API，可带用户指令；与自动 compaction 的事件、通知共用。
- Headless CLI 是否支持 prompt 里写 `/命令`。
