# 01: 三个包原样搬入 packages/coding-agent

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 新建 `packages/coding-agent`，把 `apps/neant-cli` 搬到 `src/headless/`、`apps/neant-tui` 搬到 `src/tui/`、`packages/tui` 搬到 `src/ink/`（`components` 改名 `primitives`），测试按同样结构搬入 `tests/`。对 `@neant/tui` 的引用改为指向 `ink/index.ts` 的相对路径。删除 `apps/`。两个 bin 暂时保留，行为不变。见 [spec](../spec.md)。

- [x] `packages/coding-agent` 的 package.json 依赖为三个包的并集，版本不变；workspaces、tsconfig references、bun.lock 已更新
- [x] `ink/` 不依赖 agent、i18n 和上层目录，`tui/` 只经 `ink/index.ts` 导入，包内不自引用；Agent Core 规则改为禁止导入 `@neant/coding-agent`；各规则做过负向验证
- [x] Knip、Oxlint、ADR-0005、renderer README 中的 Yoga 路径已更新
- [x] README 移到 `src/ink/README.md` 与 `src/tui/README.md`；`ink/README.md` 开头说明当前为自研实现，不是 Ink 的 fork
- [x] `dev`、`test:coding-agent` 脚本指向新路径；AGENTS.md、architecture.md、tech-stack.md、mcp.md、permission-rules.md、brand/design.md、ADR-0006/0011、`packages/coding-agent/src/ink/design-system/color.ts` 注释中的路径已更新
- [x] 未关闭的 `.scratch` 工单与 spec 路径已更新；issue-tracker.md 写明 resolved 记录中的路径以当时的提交为准
- [x] `env -u NO_COLOR bun run check` 通过，测试数与搬迁前一致

## Answer

已把 Headless CLI、TUI 与自研 renderer 的源码、测试与 fixtures 原样移入 `packages/coding-agent`。Renderer 的 `components/` 更名为 `primitives/`；TUI 仅经 `ink/index.ts` 使用其 API。两个 bin 暂时保留，统一入口由后续工单实现。依赖按原三个包取并集，精确版本不变；workspace、TypeScript、Knip、Yoga lint 例外与 Bun lockfile 同步更新。

Renderer README 和 TUI README 移到所属源码目录；更新当前文档与未关闭 spec 的路径，保留 resolved effort 的历史证据及外部 Pi 来源路径。Knip 把 `ink/index.ts` 作为内部公共入口，保留原 renderer API。中文源码扫描排除搬入源码树的 README，继续检查源文件与注释。

## Verification

- 基线 `be5b1e20bf29a3468abe60eccf96b6c5a7f2ce84`：`env -u NO_COLOR bun run check` 通过，2741 tests / 225 files，100.26s。
- 聚焦 Headless main 与 renderer 输入：49 tests / 2 files，1.129s；localization 与实际 TUI SIGTERM / Session Resume：15 tests / 3 files，2.62s。
- `bun run check:dev`、当前文档的 11 个文件相对目标、`git diff --check` 通过；225 个测试文件与原依赖并集逐项核对一致，`CLAUDE.md` 仍是指向 `AGENTS.md` 的 symlink。
- 临时 lint fixtures：17 个禁止的导入／re-export 被拒绝，`ink/index.ts` 被允许；另外 4 个更深目录的 ink 导入也被拒绝。覆盖自引用、Agent Core 的三个 override、ink 的 Agent Core／i18n／上层依赖、TUI 的目录／子模块／错误后缀入口；fixtures 已删除。验证日志在执行环境 `/tmp/neant-package-merge/01-lint.log`。
- 配置强化前一次 aggregate 通过（2741 tests，88.17s）；增加对未来深层 ink 文件的基本依赖限制后重跑最终 gate，以最终结果为准。
- 最终 `env -u NO_COLOR bun run check`：2741 pass / 0 fail / 225 files / 15537 assertions，88.29s。测试数与搬迁前一致；日志在执行环境 `/tmp/neant-package-merge/01-final-check.log`。
