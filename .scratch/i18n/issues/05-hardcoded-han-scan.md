# 05: 硬编码中文扫描测试

Status: ready-for-agent

**What to build:** 开发者在 TUI 字典与 activity 句池文件之外写中文硬编码时测试失败，新文案无法绕过 i18n。见 spec Testing Decisions 的硬编码扫描。

**Blocked by:** 02, 03, 04

- [ ] bun:test 用例扫描 TUI 源码，字典与句池文件之外出现 `\p{Han}` 即失败，失败信息列出文件与行号
- [ ] 同样覆盖 Agent Core 源码（ADR-0008：Agent Core 不产出中文）
- [ ] 注释中的中文是否放行：按实际扫描结果决定并在用例中写明
- [ ] 当前代码库下用例通过
