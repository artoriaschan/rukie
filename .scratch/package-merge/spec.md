Status: ready-for-agent

# Spec: 合并为 coding-agent 包并改名 Rukie

决定见 [ADR-0012](../../docs/adr/0012-single-coding-agent-package.md)。渲染栈替换另见 [dsh-ink](../dsh-ink/spec.md)，在本 effort 完成后进行。

## Problem Statement

Headless CLI 与 TUI 是两个应用、两个 bin，参数解析和校验重复维护。终端渲染栈单独成包，却只有 TUI 一个使用者。与终端无关的呈现逻辑散在 `screens/` 和 `components/` 里，和渲染代码混在一起，将来 web 与桌面端无法复用。

## Solution

`apps/neant-cli`、`apps/neant-tui`、`packages/tui` 合为 `packages/coding-agent`，提供一个可执行程序，用法对齐 Claude Code。包内按目录分层，用 lint 强制依赖方向。最后项目改名为 Rukie。

## User Stories

1. 作为用户，我想运行 `neant` 进入 TUI。
2. 作为用户，我想运行 `neant "问题"` 进入 TUI，并把问题作为首条 prompt 发送。
3. 作为用户，我想运行 `neant -p "问题"` 或 `cat x | neant -p`，执行一个 run 后退出，与原 Headless CLI 行为一致。
4. 作为用户，我想运行 `neant --goal "目标"` 走 Headless 的 Goal 流程。
5. 作为用户，我想在不带 `-p` 且 stdin 不是 TTY 时得到错误提示和退出码 2。
6. 作为用户，我想在 TUI 模式使用 `--output-format` 或 `--max-goal-rounds` 时得到参数错误。
7. 作为用户，我想参数错误按我的 locale 显示。
8. 作为用户，我想 `-p` 模式启动时不加载 TUI 渲染栈。
9. 作为维护者，我想两种模式共享一份参数表和校验。
10. 作为维护者，我想违反目录依赖方向时 lint 报错。
11. 作为用户，我想改名后用 `rukie` 运行，配置在 `~/.rukie` 与项目 `.rukie/`。

## Implementation Decisions

- 包：`packages/coding-agent`，bin `neant`（改名后为 `rukie`）。`src/index.ts` 导出 `main` 与 IO 类型。Agent Core 保持 `packages/agent`。删除 `apps/`，workspaces 去掉 `apps/*`。
- 目录：

  ```
  src/
    index.ts  main.ts     main 解析参数后动态 import 对应模式
    cli/                  统一参数表与校验
    headless/             原 apps/neant-cli
    tui/                  main.tsx screens/ components/ host/ input-history/
    view/                 conversation/ transcript/ commands/ i18n/
    ink/                  原 packages/tui；components 改名 primitives
  ```

- 依赖方向由 Oxlint `no-restricted-imports` 强制：
  - `main.ts` 与 `cli/` 依赖 `view/i18n` 和 shared，不静态导入 `tui/` 或 `ink/`。
  - `headless/` 依赖 agent、`cli/`、`view/`，不依赖 `tui/`、`ink/`、react。
  - `tui/` 依赖 agent、`cli/`、`view/`，并且只经 `ink/index.ts` 使用 `ink/`。
  - `tui/components` 对 agent 只做类型导入。
  - `view/` 对 agent 只做类型导入，依赖 `@neant/i18n` 与 shared，不依赖 react、`ink/`、`tui/` 或 Node API。
  - `ink/` 不依赖 agent、i18n 或上层目录。
  - 包内禁止自引用 `@neant/coding-agent`。
  - Agent Core 现有规则改为禁止导入 `@neant/coding-agent`。
- 模式判定：带 `-p`/`--print` 或 `--goal` 进 Headless，`-p` 改为布尔开关，prompt 取位置参数，缺省时读 stdin。不带时进 TUI，位置参数作为首条 prompt。不带 `-p` 且 stdin 非 TTY 时退出码 2。`--output-format`、`--max-goal-rounds` 只在 Headless 下有效。参数错误走 i18n，删除 CLI 原有的英文常量。
- 脚本：删除 `dev:cli`、`dev:tui`，只保留 `dev`；`test:tui`、`test:cli` 合为 `test:coding-agent`。
- 测试目录跟随 `src/`：`tests/headless`、`tests/tui`、`tests/ink`、`tests/view`、`tests/e2e`，各自保留 helpers 与 fixtures。
- 依赖：三个包的依赖取并集，版本不变；同步 `docs/tech-stack.md` 与 `bun.lock`。vendored Yoga 的路径在 Knip、Oxlint、ADR-0005 与 renderer README 中同步更新。
- README：renderer README 移到 `src/ink/README.md`，TUI README 移到 `src/tui/README.md`。`ink/README.md` 开头说明当前为自研实现，不是 Ink 的 fork。
- 文档：AGENTS.md、`docs/architecture.md`、`docs/tech-stack.md`、`docs/mcp.md`、`docs/permission-rules.md`、`brand/design.md`、ADR-0005/0006/0011 更新路径与包名。`.scratch` 只改未关闭的工单与 spec；`docs/agents/issue-tracker.md` 加一句：resolved 记录中的路径以当时的提交为准。
- 改名 Rukie：
  - 包作用域改为 `@rukie/*`，根包名与 bin 改为 `rukie`，用户目录改为 `~/.rukie`，项目目录改为 `.rukie/`，环境变量前缀改为 `RUKIE_`，MCP OAuth `client_name` 改为 `Rukie`。
  - 文案、CONTEXT.md 和 Logo 一并改名；Logo 字体补 `U`。
  - 不读取旧名，不写迁移代码。

## Testing Decisions

- 搬迁不改行为：工单 01 以现有测试全绿为准。
- 统一入口：通过 `main` 覆盖模式判定、互斥与仅限 Headless 的参数、非 TTY 拒绝、locale 化报错，以及 `-p` 不加载 `ink/`。
- lint 边界：每条规则做一次负向验证（临时违规导入应当报错，验证后删除）。
- 改名后验证 resume、`.rukie/settings.json` 加载、MCP OAuth 连接。

## Out of Scope

- 拆分 `tui/screens/chat/index.tsx`。
- 替换渲染栈（[dsh-ink](../dsh-ink/spec.md)）。
- 改本地仓库目录名、git remote，迁移 Claude memory。由用户在交付后处理。
