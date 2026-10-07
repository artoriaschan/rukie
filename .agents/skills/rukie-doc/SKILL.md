---
name: rukie-doc
description: Create, update, restructure or review Rukie documentation, package READMEs and ADRs; select the owning document and template, verify current behavior, repair references and run repository documentation checks.
---

# Rukie 文档维护

读取根 `AGENTS.md`、目标目录规则及[文档规范](../../../docs/AGENTS.md)，再执行[维护流程](../../../docs/agents/documentation.md)。沿用用户授权的范围；分析请求输出建议，编辑请求完成修改与验证。

## 选择模板

根据读者要完成的事选择一种骨架，只读取相关模板，已有短文按需调整：

| 文档      | 模板                                   | 使用时机                     |
| --------- | -------------------------------------- | ---------------------------- |
| 包 README | [package.md](templates/package.md)     | 调用方选择、使用或排查一个包 |
| 能力参考  | [reference.md](templates/reference.md) | 查配置、语义、失败和资源归属 |
| 操作教程  | [tutorial.md](templates/tutorial.md)   | 按步骤完成一个结果并验证成功 |
| ADR       | [decision.md](templates/decision.md)   | 保存长期架构决定及取舍       |

ADR 的格式与状态由[决策记录规则](../../../docs/adr/README.md)定义。审阅既有文档时先读取拥有该行为的源码、配置或脚本；按文档规范检查遗漏的义务、重复内容、实施过程和不一致的引用。

## 交付

按维护流程完成事实核对、引用修复和验证，报告实际运行的命令与未验证行为。迁移文档时检查所有入链；同时修改代码时完成根规则要求的行为测试与完整检查。文档检查通过只说明其机械规则满足，不代表外部服务或产品行为验证通过。
