# 04：`host.*` wire 命令与 Electron 迁移

Status: resolved

**What to build:** 按 [spec](../spec.md#wire-命令) 与 [ADR-0037](../../../docs/adr/0037-browser-host-sidecar-capabilities.md#原生能力)，sidecar 提供选择文件夹、在 Finder 中显示、在终端打开；Electron 与浏览器共用显示与终端路径。

- [x] `WireCommandSchema` 新增 `host.pickFolder`、`host.revealPath`、`host.openInTerminal`
- [x] 路径必须为已存在的绝对路径；显示与终端只接受已登记项目根、无项目会话 workspace 及其子路径
- [x] macOS：`osascript` 固定脚本源选择文件夹、`open -R`、`open -a Terminal`；Linux：`xdg-open`（显示文件时打开所在目录），选择文件夹返回 `unsupported`；Windows：`explorer /select,` 与默认终端，选择文件夹返回 `unsupported`；全部参数向量执行，不经 shell
- [x] 浏览器 host 实现 `pickProjectFolder`；`unsupported` 与取消时界面退回手动填写路径
- [x] `revealPath`、`openInTerminal` 移出 `DesktopHost`，app 经 wire 调用；删除 main 的 IPC 与 preload 暴露。Electron 保留窗口内 `pickProjectFolder`
- [x] server 测试通过注入的执行接口验证参数向量与路径限制，不真实弹窗或启动进程；ui Chromium 测试覆盖成功、取消、unsupported；desktop 测试验证 IPC 已删除
- [x] 更新 desktop、ui README 中 `DesktopHost` 能力说明

## 验证记录

Seams: authenticated server WS + injected external process executor; browser host/app through scripted WS; Electron main/preload fixed IPC surface. Spec authorizes these boundaries. No DOM/CSS geometry change.

Implementation: sidecar owns `host.*`; canonical realpath containment denies missing/relative/NUL paths and symlink escapes. All three platform argv adapters use the injected executor. macOS folder script is fixed source; cancel returns null; non-macOS returns unsupported. Browser host binds the app's one WS client (never acquires a second socket). Electron reveal/terminal IPC removed, app always sends wire commands. Both README contracts updated; host lint boundary allows client composition per ADR-0037 while retaining upper-layer restrictions.

Evidence (commands run from repository root unless noted):

- Dependencies: `rtk proxy bun install --frozen-lockfile`; successful. Initial focused test before install could not load `@sinonjs/fake-timers`; this was setup failure, not behavior reproduction.
- Red: desktop cwd `rtk proxy node ../../node_modules/vitest/vitest.mjs run tests/preload.test.ts tests/main.test.ts` failed both removal assertions before production IPC deletion (556 ms).
- Green: same desktop focused command: 12/12 pass, 501 ms; no actual Electron UI or process was launched.
- `rtk proxy env -u NO_COLOR bun test packages/server/tests/server.test.ts -t 'host '` — 4/4 pass, 393 ms; slowest host test 32.80 ms. External native processes/dialogs substituted only at executor boundary.
- ui cwd `rtk proxy node ../../node_modules/vitest/vitest.mjs run --project ui-browser tests/app/host.browser.test.tsx tests/app/shell.browser.test.tsx` — 15/15 pass, 9.20 s. Prior new-test run used incorrect English `Open` label and failed locator lookup; corrected to actual `Open with`.
- Reduced duplicate native menu interaction coverage to selected-folder scenario; ui cwd `rtk proxy node ../../node_modules/vitest/vitest.mjs run --project ui-browser tests/app/host.browser.test.tsx --reporter verbose` — 3/3 pass, 3.93 s (selected 1904 ms, cancelled 428 ms, unsupported 432 ms). Selected case intentionally pays Chromium UI/real WS startup plus two native-entry menu interactions; duplicate cases now test only their distinct fallback semantics.
- `rtk proxy bunx --no tsc -b packages/server packages/ui packages/desktop` passed.
- Focused `rtk proxy bunx --no oxlint` over changed server/UI/desktop source/test files passed after updating the owning host-layer rule for ADR-0037 client composition; `rtk proxy bunx --no oxfmt` formatted all changed files; `rtk git diff --check` passed.
- `rtk proxy bun run check:docs` passed (146 Markdown files).

Verification ownership: root coordinates aggregate static, desktop package acceptance, final agent-browser acceptance and CI. No layout/style/primitive geometry changes. Existing shell browser regression passed. ADR coverage: this ticket implements ADR-0037 native ownership and path authorization, continuing ADR-0031 WS auth and ADR-0029 browser-compatible host boundary. Actual system dialogs and terminal/file-manager launching remain user-authorized native acceptance, not claimed by these injected tests.
