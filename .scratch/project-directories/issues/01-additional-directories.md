# 01：Agent Core 附加目录

Status: ready-for-agent

Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md#附加目录agent-core) 为 `createSession` 增加 `additionalDirectories`：Session 仍只有一个 cwd，附加目录只贡献环境快照中的路径与各自 `AGENTS.md` 的 Project Instructions。

- [ ] `createSession` 接受 `additionalDirectories`（绝对路径列表，去重并排除 cwd 本身），不改变工具执行目录、权限路径解析与文件跟踪
- [ ] 首次 Run 的环境快照列出附加目录
- [ ] 每个附加目录的 `AGENTS.md` 作为 Project Instructions 加载，内容变化时按现有 reminder 比对重新注入；Session Resume 后可从 Transcript 重建
- [ ] 附加目录中的 `.rukie/settings.json`、hooks、`.mcp.json` 与技能不加载
- [ ] 新增 ADR 记录附加目录边界（与 02 的 Session Move 合并为一条 ADR 时，由先完成的票创建、后完成的票补充），运行 `bun run docs:update`
- [ ] CONTEXT.md 的 Session 词条说明附加目录
- [ ] 测试：`createSession` + fake model 覆盖环境快照、指令加载与变化重注入、配置不加载、Resume 后重建
