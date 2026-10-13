# 01：Agent Core 附加目录

Status: claimed

Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md#附加目录agent-core) 为 `createSession` 增加 `additionalDirectories`：Session 仍只有一个 cwd，附加目录只贡献环境快照中的路径与各自 `AGENTS.md` 的 Project Instructions。

- [x] `createSession` 接受 `additionalDirectories`（绝对路径列表，去重并排除 cwd 本身），不改变工具执行目录、权限路径解析与文件跟踪
- [x] 首次 Run 的环境快照列出附加目录
- [x] 每个附加目录的 `AGENTS.md` 作为 Project Instructions 加载，内容变化时按现有 reminder 比对重新注入；Session Resume 后可从 Transcript 重建
- [x] 附加目录中的 `.rukie/settings.json`、hooks、`.mcp.json` 与技能不加载
- [x] 新增 ADR 记录附加目录边界（与 02 的 Session Move 合并为一条 ADR 时，由先完成的票创建、后完成的票补充），运行 `bun run docs:update`
- [x] CONTEXT.md 的 Session 词条说明附加目录
- [x] 测试：`createSession` + fake model 覆盖环境快照、指令加载与变化重注入、配置不加载、Resume 后重建

## Comments

- 2026-10-13：ticket_01 认领；基线为 feat/project-directories 祖先，公开测试 seam 为 createSession + fake model。

### Verification record

- Owner：ticket_01。环境：macOS、Bun 1.4.2，隔离 tempDirs cwd/homeDir，fake model；`rtk proxy bun install --frozen-lockfile` 成功（888 packages，1.208 s），未更改 lockfile。
- Red 1：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/reminders.test.ts -t 'additional directories appear once'`，0 pass / 1 fail / 7 filtered，224 ms；环境快照缺附加目录路径。实现后同命令 1 pass / 0 fail，176 ms。
- Red 2：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/reminders.test.ts -t 'additional Project Instructions'`，0 pass / 1 fail / 8 filtered，182 ms；模型输入缺附加 AGENTS 内容。实现后同命令 1 pass / 0 fail，204 ms。
- Green：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/reminders.test.ts`，11 pass / 0 fail，56 assertions，591 ms；新增用例均小于 1 s。覆盖路径去重/cwd 排除、AGENTS 独立变化、Resume 前缀重建且不重复、配置/hook/MCP/skill 不加载、工具相对路径仍以 cwd 为准、相对附加路径拒绝。
- ADR coverage：附加目录边界归 ADR-0039；Session Move 由票 02 单独 ADR 记录。票保持 claimed，集成验收后由主代理关闭。

- 静态/文档：`rtk proxy bunx --no oxlint packages/agent/src/session/index.ts packages/agent/src/reminders/index.ts packages/agent/tests/e2e/reminders.test.ts`、`rtk proxy bunx --no tsc -b packages/agent`、`rtk proxy bun run docs:update`、`rtk proxy bun run check:docs`（148 Markdown files）、修改文件 `oxfmt --check` 与 `rtk git diff --check` 均通过。未运行 aggregate check:dev/full suite 或 GUI，由主代理统一组织。
- 共享 reminder 收集器也用于 Compaction，增量消费者检查：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/compaction-hooks.test.ts -t 'manual compaction hooks receive'`，2 pass / 0 fail / 15 filtered，14 assertions，321 ms；复用此前 reminders 的 11 pass 证据。
