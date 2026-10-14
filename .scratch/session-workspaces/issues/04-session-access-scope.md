# 04：Session 访问范围

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md#session-访问范围工单-04) 与 [ADR-0044](../../../docs/adr/0044-session-access-scope.md)，在 Agent Core 权限模块按访问范围决定文件工具的模式默认值。

- [ ] 计算范围：cwd、附加目录（读写），已发现技能根、本 Session Job 输出目录（只读）；按真实路径判定
- [ ] `read`/`glob`/`grep`/`write`/`edit` 的模式默认值按 ADR 表格；hooks、规则、Permission Review 阶段与 `bash`/MCP/`web_fetch` 不变
- [ ] 目录级“本 session 允许”沿用；子 Session 使用父范围；Headless CLI 无回调时范围外拒绝
- [ ] 测试：`createSession` + fake model 覆盖范围内外三种模式、只读范围写入询问、技能引用文件放行、显式 deny/ask 优先、目录授权覆盖子路径、子 Session、Headless 拒绝与 `--allow-tools` 放行；更新依赖“读取全局放行”的既有用例
- [ ] 文档：docs/permission-rules.md、Agent README、CONTEXT.md 新增 Session 访问范围词条

## Comments
