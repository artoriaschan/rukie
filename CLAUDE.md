## Tech stack

Pinned versions and deviations from the original list: see `docs/tech-stack.md`. Update it whenever a dependency version changes.

## Repo layout

Bun workspaces (`apps/*`, `packages/*`). Internal packages are not built: `exports` points at `src/index.ts` and dependents use `workspace:*`.

```
apps/
  neant-cli/    @neant/neant-cli  argv → Agent Core → text / stream-json output
  neant-tui/    @neant/neant-tui  neant → Agent Core → inline conversation / scrollback
    src/{components,screens}/
  server/       (later) @neant/server   Hono + WS
  desktop/      (later) @neant/desktop  src/{main,preload,renderer}
packages/
  shared/       @neant/shared   runtime-agnostic types, typebox schemas, pure functions
  tui/          @neant/tui      React reconciler → TS Yoga → cell grid → ANSI
    src/{components,design-system,hooks,input,terminal,renderer,layout,text,screen,yoga}/
  agent/        @neant/agent    Agent Core
    src/index.ts
    src/{session,prompt,reminders,tools,permissions,skills,mcp,store,config}/
```

Rules:

- **One directory per concept** in `CONTEXT.md` (applies to `packages/agent`), even if it holds a single file. Each directory exposes its public API through `index.ts`; other modules import only from that `index.ts`, never from inner files.
- **UI is layered** (after dsh-TUI): ① renderer primitives `packages/tui/src/components/` → ② design system `packages/tui/src/design-system/` (theme + theme-aware parts) → ③ app components `apps/<app>/src/components/<area>/` → ④ screens `apps/<app>/src/screens/`. Imports only point downward. ①② know nothing about Agent Core; ③ takes props only; ④ wires Session and owns state. ③ is split by UI area (not by `CONTEXT.md` concept), each area exposes `index.ts`, collected by `components/index.ts`.
- **Tests live in `tests/`** at each package/app root, mirroring `src/` (`tests/reminders/reminders.test.ts`). Cross-concept run tests go in `tests/e2e/`, test utilities (fake `streamFn`, temp dirs) in `tests/helpers/`.
- **Test runner follows runtime** (ADR-0004): Bun code uses `bun:test`; Electron main and renderer use Vitest.
- **`@neant/shared` must stay runtime-agnostic**: no `Bun.*`, `node:*` or DOM APIs; the only allowed dependency is `typebox` (added once something uses it). Something goes into shared only if at least two packages use it.
- TypeScript: root `tsconfig.base.json`, each package `extends` it; typecheck all packages with `tsc -b`.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
