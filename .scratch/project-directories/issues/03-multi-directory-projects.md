# 03：桌面端多目录 Project 与信任确认

Status: claimed

Blocked by: 01

**What to build:** 按 [spec](../spec.md#project-登记表)、[信任](../spec.md#信任) 与 [切换主目录](../spec.md#切换主目录)，把桌面端 Project 改为多目录并带显式信任状态，替换 `project.add`，从 UI 到 Agent Core 端到端可用。

- [x] registry 与 `WireProject` 改为 `{ id, name, directories, primary, trusted }`；旧记录迁移为单目录、未信任；store 解析同步
- [x] `project.create` 替代 `project.add`：校验目录存在且为真实路径、`trusted: true`、`<dataRoot>` 保留（`project_reserved`）、重叠（`project_conflict` + 冲突 Project 名）、主目录已存在时返回已有 Project；删除 `project.add` 及其消费方
- [x] `project.trust` 与 `project.setPrimary`
- [x] 打开 Session 时把已信任 Project 的全部目录并入 `trustedProjects`，并把所属 Project 的其余目录作为 `additionalDirectories` 传入
- [x] 侧栏分组改为 cwd 等于 Project 任一目录；搜索浮层的 Project 名称与标题栏当前 Project 同步
- [x] 创建流程：选择一个或多个目录，第一个为主目录；目录列表项 hover 或聚焦显示“设为主要”；信任确认框列出目录与影响，取消不发送命令；“打开文件夹”走同一流程；主目录已存在时直接在该 Project 新建会话
- [x] 未信任 Project 在打开或新建 Session 前补确认；拒绝时照常运行
- [x] 按 DESIGN.md 实现目录列表与确认框（先补充 DESIGN.md 规则），先过 layout preservation gate；zh 与 en 同步
- [x] ADR 记录桌面端显式信任与精确匹配；更新 CONTEXT.md Project 词条、docs/hooks.md、docs/permission-rules.md
- [x] 测试：服务端 wire、store Node、UI browser 按 spec 覆盖；布局回归用例

## Comments

- 2026-10-13: fresh implementer on `feat/project-directories-03`, baseline integration `2977cf69`; approved seams: server wire, App fake wire browser, store Node and native picker mocks. Frozen install passed (888 packages, 1.20s). Layout baseline before edits: `cd packages/ui && node ../../node_modules/vitest/vitest.mjs run --project ui-browser tests/app/layout.browser.test.tsx`: 4/4 passed, 2.86s, Chromium, <=1px geometry. Initial root cwd invocation found no tests; corrected cwd.

- Implementation: registry `{id,name,directories,primary,trusted}` and legacy path migration (untrusted); wire replaces `project.add` with create/trust/setPrimary; canonical equality, reserved descendants and named conflict errors; opens derive trusted directory settings and supply all other Project directories. Main switches preserve existing cwd. UI shares multi-directory selection and confirmation across Add project/Open folder, exposes primary controls inside Project directory dialog through existing target dropdown, exact cwd grouping/search/header. Reused installed beUI MorphingModal/Input/Button and ScrollArea; directory-specific content requires composition rather than a new registry primitive. DESIGN updated before UI source edits. ADR-0041 + CONTEXT/hooks/permission docs agree.
- Red/green: wire multi-directory test initially failed on absent create result (0/1, 209ms), then named-conflict params failed until CommandError forwarding was fixed; basic green 1/1, 178ms. Same-id runtime trust test red 0/1, 260ms (newly granted hooks absent), green 1/1, 394ms after idle execution reopen. Untrusted reopen browser test red 1 failed/1 passed (15.98s), green 2/2 (1.38s): declining only covers the current opening/draft and does not suppress later confirmation.
- Focused server acceptance: `bun test packages/server/tests/server.test.ts`: 46/46 passed, 2.62s. This scope covers changed loadSettings, find/reopen, project commands and host boundaries; lifecycle cases run real Bun/WS/SQLite, no fixed sleeps. `bun test packages/server/tests/storage/app-database.test.ts`: 7/7 passed, 148ms including on-disk legacy fixture migration. Multi-directory wire also checks symlink equality and reserved alias, nested independent ownership, invalid directories/trust, unchanged Project name, setPrimary membership and obsolete command rejection.
- UI Node: `cd packages/ui && node ../../node_modules/vitest/vitest.mjs run --project ui-node tests/store/desktop.test.ts tests/client/wire.test.ts`: 16/16 passed, 324ms. Added malformed multi-directory membership/trust parser case, then incremental store file 12/12 passed, 197ms. Client evidence remains valid.
- Chromium: combined changed consumers + new test + layout initially 33 passed/6 failed (31.81s): obsolete host fixture expectations, focus handoff across two dialogs and Project dropdown submenu regression; repaired implementation and fixtures. Incremental host/search/shell 33/33 passed, 13.56s. New project-directory browser file final 6/6 passed, 3.95s: first primary, focus/hover actions, create cancellation, trust/decline/reopen, any-directory grouping and search, duplicate-primary direct draft, setPrimary and new chat wiring, conflict/reserved localized failures. Existing layout 4/4 passed both before edits and after initial completed UI in combined run; Light/Dark, desktop/narrow geometry within original 1px tolerance. Trust modal preserves measured main left/width. Expensive consumer integration timings arise from actual Chromium input/overlay/transport work; the new file remains <4s total, no sleep synchronization.
- Desktop: `cd packages/desktop && node ../../node_modules/vitest/vitest.mjs run tests/main.test.ts tests/preload.test.ts`: 13/13 passed, 806ms, native picker mock accepts multiSelections and returns the full selection; IPC origin authorization stays in place. macOS browser-host AppleScript selection covered via injected executeHost, no real native picker/Electron launch.
- Static/docs: `bunx --no tsc -b` passed after final trust change; focused `bunx --no oxlint ...` passed; scoped oxfmt passed; `bun run docs:update` and `bun run check:docs` passed (149 Markdown files); `git diff --check` passed. Formatter-only changes preserve behavior evidence.
- Trust reload boundary: a Project trust update does not interrupt active Runs; next idle execution closes stale Core configuration and reopens existing id. Server has one active socket (supersession releases the previous socket); prompt re-subscribes the active consumer. Passive history reads do not decrypt or recover execution.
- Delivery remains claimed pending whole-spec review/05 aggregate + isolated agent-browser acceptance. Lifecycle config reopen is a concrete cross-module reason for the root's one final full check; none run by this owner. No push, PR or native acceptance here.
