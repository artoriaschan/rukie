# 04: 项目改名 Rukie

Status: resolved
Blocked by: 03

**What to build:** 完成项目的 Rukie 命名，只做文本替换和必要的资源补充，不改结构。见 [spec](../spec.md) 的"改名 Rukie"。

- [x] 包作用域为 `@rukie/*`，根包名与 bin 改为 `rukie`，同步 bun.lock 与 lint 规则中的包名
- [x] 用户配置在 `~/.rukie`，项目配置在 `.rukie/`（settings、mcp、AGENTS.md、agents、sessions、file-history、input-history）；不读取旧名
- [x] 环境变量使用 `RUKIE_*` 前缀，包括 hook 的 `RUKIE_PROJECT_DIR` 与测试变量
- [x] MCP OAuth `client_name` 改为 `Rukie`；验证 resume 与 MCP 连接
- [x] zh 与 en 文案、CONTEXT.md 标题与首句、AGENTS.md、docs、brand/design.md 改名
- [x] Logo 显示 `RUKIE`；`splash-font.ts` 补 `U` 字形，沿用现有 5 行粗体格式；终端断言覆盖新 Logo
- [x] 未关闭的 `.scratch` 工单与 spec 改名；resolved 记录不动
- [x] `env -u NO_COLOR bun run check` 通过
- [x] 交付说明写明用户需手动执行：`mv ~/.neant ~/.rukie`；各项目执行 `mv .neant .rukie`；更新自写 hook 脚本中的环境变量；改仓库目录名与 git remote；迁移 `~/.claude/projects/` 下的 memory 目录

## Answer

包作用域、根包与唯一 bin、配置和持久化路径、环境变量、系统提示、MCP 身份、双 locale 文案、当前文档及 brand 统一为 Rukie。bin 指向统一 `src/main.ts`，Bun lock 的 workspace bin metadata 同步为同一入口；入口保留 shebang 并具备可执行权限。外部依赖版本与目录结构保持一致。补齐五行六列 U 字形，宽屏 RUKIE raster 与窄屏 Rukie 文案均经过真实终端断言。

Session 的思考时长 metadata writer、reader 与模型边界剥离统一使用 `rukieThinkingDurationMs`，没有旧配置目录读取或自动迁移。实际 OAuth 初次连接、授权与显式 reconnect 的注册客户端均采用 Rukie，MCP initialize 身份为 rukie，credentials 位于新目录并可被新 Session 复用。

未关闭的 scratch 工单与 spec 已同步当前名称。269 个已关闭或历史记录（包括 01 / 02 / 03 及已关闭 feature 的补充记录）在改名前后 hash 一致；ADR-0012 与本 spec 保留真正的历史 `apps/neant-cli` / `apps/neant-tui` 输入路径，Pi / dsh-TUI provenance 保留。

## Verification

- Red：新配置与忽略旧配置的公开测试复现旧目录仍被读取；宽 / 窄终端 Logo 复现旧名称；实际 Session 思考 metadata 与本地 OAuth 注册测试复现旧名称。证据 `/tmp/neant-package-merge/04-red.log`、`04-red-oauth-thinking.log`。
- settings、thinking / resume、真实 hook child、新 Logo、OAuth lifecycle 共 125 个受影响用例已验证；首次 focused 124 pass，另一个新增 OAuth 断言对无 body 请求处理错误，修正为 TypeBox 检查后 OAuth 18 pass / 0 fail / 73 assertions，722ms。其他 focused 用例原次均通过，总 focused 2.46s；没有新增固定等待。证据 `/tmp/neant-package-merge/04-focused.log`、`04-oauth.log`。
- 配置测试同时写入新 `.rukie` 配置与损坏的旧 `.neant` 配置，公开 loadSettings 正常加载新目录并忽略旧目录；legacy-only 得到空 settings。实际 Session 保存到 `.rukie/sessions` 并成功 resume，思考时长保留且 metadata 不进入模型历史；旧 sessions 路径未创建。
- 本地真实 HTTP MCP fixture 验证 initial OAuth registration `client_name: Rukie` 与 initialize `name: rukie`，clear auth 后显式 reconnect 产生新注册且名称仍为 Rukie；公开状态返回 needs-auth。新 Session 复用 `.rukie/credentials.json`，旧 credentials 路径未创建。
- 全部 workspace manifest 与 Bun lock 使用新包名，frozen install 成功。8 / 8 新 package alias 的负向 / type-only 正向 lint probes 符合预期，临时 fixtures 已删除。证据 `/tmp/neant-package-merge/04-lint.log`。
- 独立真实 consumer workspace 安装后的 `node_modules/.bin/rukie` 为统一 main 的 symlink，入口权限 0755，没有 rukie-cli；实际可执行文件的 Headless-only 参数与无 flag 的 piped stdin 均返回 2，显示正确英文参数提示及 rukie -p 引导，HOME 隔离。证据 `/tmp/neant-package-merge/04-bin-smoke.log`；consumer 与其 HOME fixture 已删除，checkout 的依赖已由 force frozen install 恢复后通过 static 检查。
- 首次 full gate 2773 pass / 1 fail（92.67s），唯一失败是 resume 场景残留的旧 Logo raster 字符串；源码运行与 resume 正常。更新期望后 focused resume 5 pass / 0 fail / 62 assertions，1.065s，并为该测试变化重新执行最终 aggregate。证据 `/tmp/neant-package-merge/04-first-check-failed.log`、`04-focused-resume.log`。
- `bun run check:dev` 通过；改动文档的相对目标检查与 `git diff --check` 通过。已关闭 scratch 的 hash 检查 269 / 269 一致；当前非历史旧名称仅限旧目录拒绝测试与准确的历史输入路径。

- 最终 `env -u NO_COLOR bun run check`（隔离 HOME）：2774 pass / 0 fail / 227 files / 15635 assertions，100.62s；format / lint / types / Knip / scratch 同时通过。证据 `/tmp/neant-package-merge/04-final-check.log`。

## 用户手动迁移

本次不操作用户数据。用户需执行 `mv ~/.neant ~/.rukie`，各项目执行 `mv .neant .rukie`；将自写 hook 的旧环境变量引用改为 RUKIE_ 前缀（项目路径变量为 RUKIE_PROJECT_DIR）。仓库目录名、git remote 与 `~/.claude/projects/` 下对应 memory 目录由用户手动更新。
