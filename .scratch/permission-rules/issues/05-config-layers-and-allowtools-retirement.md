# 05: 配置层级与 allowTools 退役

**What to build:** 项目 `.neant/settings.json` 的 `permissions.deny` 和 `ask` 总是与用户层合并；项目层的 `permissions.allow` 只在 Trusted Project 下生效，否则丢弃并警告（与项目级 `.mcp.json` 共用同一个信任判定）。这修掉了项目级 `allowTools` 可以放宽权限的漏洞。`allowTools` 退役：任一层出现时报错，提示迁移到 `permissions.allow`。CLI / TUI 的 `--allow-tools` 参数名不变，改为接受规则语法，作为会话级 allow 规则传给 session 的 `allowRules` 选项；规则非法时启动失败，并指出来源 `--allow-tools`。

Blocked by: 02

Status: resolved

参考：[spec](../spec.md)「配置层级与来源」；User Stories 19–23。

- [x] settings 测试：用户层与项目层的 deny / ask 合并；非 trusted 时项目 allow 被忽略并告警；trusted 时生效
- [x] settings 测试：任一层出现 `allowTools` 都报错，错误含文件路径和迁移提示
- [x] session 选项 `allowTools` 改名为 `allowRules`；代码中不再有 `allowTools` 的读取路径（contract）
- [x] CLI 与 TUI 测试：`--allow-tools 'bash(git status*)'` 生效；非法规则报错
- [x] `loadSettings` 注释与实际行为一致
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

### 2026-10-04 implementation checkpoint — review pending

- 用户与项目 `permissions.deny` / `ask` 追加合并；项目 allow 仅通过用户层精确目录 `isTrustedProject` 判定后追加，否则丢弃并警告。与项目 MCP 共用该判定；项目自写 trustedProjects 无效，`--trust-project-mcp` 保持 MCP 专用，不放宽权限规则。
- 任一 settings 文件只要出现 `allowTools` 就报 typed `allow-tools-retired`，参数含 source 路径，明确提示迁移 `permissions.allow`；common 双语与 TUI formatError 已接线。Settings schema 与 SessionOptions 删除旧字段，SessionOptions 改为 allowRules，模式阶段不再读取工具名 allowTools 旁路。
- Headless CLI / TUI `--allow-tools` 使用同一公开规则 parser，非法规则在读取 stdin / 进入渲染前退出，错误 source 为 `--allow-tools`。公开测试验证 `bash(git status*)`、命令内逗号、brace glob 保留完整规则并执行匹配命令；未匹配命令仍拒绝。未修改 issue 03 / 04 的 matcher。
- TDD: settings 29 pass / 5 fail → 34 pass / 0 fail；Session 新 allowRules 接线 15 pass / 2 fail → 17 pass / 0 fail；CLI/TUI 启动错误 0 pass / 6 fail → 6 pass / 0 fail。原 fixture 全部迁移至 permissions.allow / allowRules；相关 focused 四文件最终 135 pass / 0 fail，416 assertions，exit 0。
- 第一轮 full check 842 pass / 1 fail，原因是 fullscreen 非交互终端测试未注入临时 home，读取真实用户旧 allowTools 配置提前触发迁移错误。保留运行时启动顺序，只修复该测试的 cwd/home 隔离；focused 1 fail → 1 pass。
- 最终冻结代码验收 `rtk proxy env -u NO_COLOR bun run check`: exit 0，843 pass / 0 fail，65 files，5004 assertions，112.17s；oxfmt、oxlint、tsc -b、knip 全部通过。日志 `/tmp/neant-permission-05-check-final.log`。`git diff --check` 通过；src 的 allowTools 残留仅迁移检测与双语迁移文案。
- 本 checkpoint 实现完成，Standards / Spec 双轴 code review 待父代理安排，工单保持 in-progress。父代理负责串行合并 main、集成验收与 worktree 归档。

### 2026-10-04 review fix checkpoint — delta review pending

- 首轮独立双轴 review：Spec 0 findings；Standards 1 项 P2 hard finding：新增 Trusted Project / MCP 公开 Run 测试放在 config suite，违反 CLAUDE.md 的跨概念 Run 测试目录约定。
- 仅将这组测试（untrusted、MCP 专用 flag、用户精确信任三个场景）原样移动至 `packages/agent/tests/e2e/permission-rules.test.ts`，整理两文件 import；全部 fixture 与行为断言保持，runtime 实现不变。纯 settings 加载测试保留原位。
- 修复验证：focused `rtk proxy env -u NO_COLOR bun test packages/agent/tests/config/settings.test.ts packages/agent/tests/e2e/permission-rules.test.ts` exit 0，54 pass / 0 fail，109 assertions；独立 `rtk proxy bunx tsc -b` exit 0。
- 冻结修复后的完整 `rtk proxy env -u NO_COLOR bun run check` exit 0，843 pass / 0 fail，65 files，5004 assertions，112.44s；oxfmt、oxlint、typecheck、knip 均通过。日志 `/tmp/neant-permission-05-review-fix-check.log`。
- 修复 checkpoint 待父代理对 delta 执行双轴复审；工单继续 in-progress。

### 2026-10-04 final review completed

- 父代理对 `ebcef172e9cc364b7930c642118270011db719b2...c28b4bc0c264cd54e0bd3bc9e33c8aaf4f5ca96b` 修复 delta 执行独立 Standards / Spec 双轴复审，两轴均 0 findings。
- 原 Standards P2 已解决：跨概念 Run 测试位于 e2e suite，三个场景的行为断言与 fixture 原样保留；runtime 实现未改。首轮 Spec 与修复复审均确认无待处理问题。
- issue 05 resolved。本次仅更新票据状态与 review 证据，沿用修复冻结代码的完整验收：exit 0，843 pass / 0 fail，65 files，5004 assertions，112.44s；不重复执行未变代码的验证。父代理负责后续 main 合并、集成验收与 worktree 归档。
