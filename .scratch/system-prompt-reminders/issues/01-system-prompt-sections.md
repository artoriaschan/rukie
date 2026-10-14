# 01：System Prompt 分节生成

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md#system-prompt工单-01) 与 [ADR-0046](../../../docs/adr/0046-system-prompt-sections-and-reminder-roles.md)，根 Session 用 `section()` 生成 System Prompt，子代理通用规则并入 `SUBAGENT_PROMPT`。

- [ ] 各节按已注册工具、平台与 shell 输出；时间、Git 分支与状态不进入
- [ ] 环境节给出 cwd、附加目录与平台；Session Move 后追加新环境节；`environment` 快照只保留 Git 分支与状态
- [ ] 回复语言、指令优先级、System Reminder 可信度、用户数据目录禁读
- [ ] `SUBAGENT_PROMPT` 加入子代理规则
- [ ] `contextUsage`、`contextReport`、Side Question 使用实际渲染的 System Prompt
- [ ] 测试：相同输入字节一致、日期不影响、cwd 只改变环境节、Compaction 后环境节仍在、Session Move 与 Resume/Rewind 投影一致、工具集差异、子代理与 Side Question 文本
- [ ] 文档：`docs/architecture.md` 模型上下文一节，CONTEXT.md Session Move 词条中的环境快照描述

## Comments
