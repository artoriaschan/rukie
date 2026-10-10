# 03: 模型目录

Status: resolved

Blocked by: —

**What to build:** 用异步的 `listModelCatalog(settings)` 替换 `listModels`。每项包含 `spec`、`id`、`name`、`providerId`、`providerName`、`input`、`reasoning`、`thinkingLevels`、`contextWindow`、`custom`、`authenticated`。凭据检查用 `getAuthenticatedProviders()`，不发网络请求。更新所有调用方（TUI 的 chat 屏幕会在打开面板时等待目录加载）。见 spec「Agent Core」模型目录部分。

- [x] 隔离 env 和 settings 下，`authenticated` 随 env 变量是否存在而变化；自定义 provider 的 `custom` 为 true
- [x] `thinkingLevels` 与 pi 的 `getSupportedThinkingLevels` 一致；自定义模型 `reasoning: false` 时为 `["off"]`
- [x] 调用方与测试 helper 都已切换，Knip 不再报 `listModels`

## Implementation and verification

- `listModelCatalog` exposes all requested model/provider/capability facts and preserves unauthenticated models. All imports, TUI consumers and async test helpers use the new API; the obsolete `listModels` export is removed. TUI reloads the catalog before opening the panel and surfaces load errors without blocking direct `/model <spec>`; the initial metadata load tolerates catalog errors.
- Locked pi-ai 1.0.4 keeps `getAuthenticatedProviders()` private in its implementation, rather than exposing it through `Models`. Rukie uses a local helper of that name composed from public `checkAuth()`. The inspected OAuth branch checks the stored credential and available OAuth method without refreshing; the API-key branch checks local configuration. No model refresh or request API is used.
- TDD: new public catalog test initially failed because the export did not exist, then passed after implementation. Custom and built-in environment credentials are restored in `finally`; the custom provider points at an unreachable endpoint, so the passing catalog check does not require a network request.
- `bun test packages/agent/tests/config/settings.test.ts`: 51 pass in 1.53 s; after the final built-in credential case, the focused `-t 'model catalog'` run has 3 pass in 248 ms (catalog cases 1.40–4.71 ms).
- `env -u NO_COLOR bun test packages/agent/tests/e2e/model-switch.test.ts packages/coding-agent/tests/tui/screens/chat/model-switch.test.ts packages/coding-agent/tests/tui/screens/chat/resume-picker.test.ts`: 11 pass in 3.43 s. The first TUI scenario took 1.40 s including application startup, Session storage and terminal completion predicates; it adds no real sleep and uses the existing virtual-clock fixture.
- `bunx --no -- tsc -b` and `bun run check:dev` passed (format, lint, types, Knip, tracker, docs, ink boundaries, test policy). The initial static run stopped on formatting of the newly added test; formatting was corrected before the passing run.
- ADR coverage: catalog facts remain locale-agnostic under ADR-0008; model/auth behavior reuses the locked harness under ADR-0024. This API rename and local credential projection introduce no new durable architectural decision. Full acceptance is owned by the integration branch.
