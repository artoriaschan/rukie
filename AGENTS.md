# AGENTS.md

Rukie is a coding agent. Agent Core owns Session execution; Headless CLI and TUI drive it as frontends. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`, [CONTEXT.md](CONTEXT.md) before changing domain behavior, and the relevant [ADRs](docs/adr/) before changing architecture. Follow [docs/AGENTS.md](docs/AGENTS.md) and the repository [rukie-doc skill](.agents/skills/rukie-doc/SKILL.md) when writing documentation. Use the glossary's terms in code, tests, issues, and documentation.

## Repository layout

| Path                                  | Owns                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/coding-agent/src/headless/` | `@rukie/coding-agent`: non-interactive argv/stdin → Agent Core → text or stream-json output                  |
| `packages/coding-agent/src/tui/`      | `@rukie/coding-agent`: interactive `rukie`, fullscreen conversation, input, dialogs, and app state           |
| `packages/agent/`                     | `@rukie/agent`: Sessions, tools, permissions, hooks, skills, MCP, context, persistence, and subagents        |
| `packages/coding-agent/src/ink/`      | `ink/`: React reconciler, terminal input, layout, cell grid, ANSI rendering, and design system               |
| `packages/shared/`                    | `@rukie/shared`: runtime-agnostic types, TypeBox schemas, and pure functions shared by at least two packages |
| `packages/i18n/`                      | `@rukie/i18n`: runtime-agnostic locale resolution, common copy, interpolation, and durations                 |
| `CONTEXT.md`, `docs/adr/`             | Domain vocabulary and architectural decisions                                                                |
| `docs/agents/`                        | Issue tracking, triage, and domain-document workflows                                                        |
| `.scratch/`                           | Local feature specs, implementation tickets, and investigation records                                       |

## Commands

Bun manages the `packages/*` workspaces. Run commands from the repository root.

```sh
bun install                                      # install workspace dependencies
bun run dev                                      # TUI; requires an interactive terminal and provider credentials
bun run dev -- -p "task"                        # Headless CLI; requires configured credentials
bun run test:agent                               # Agent Core tests
bun run test:coding-agent                        # Headless CLI, TUI and renderer tests
bun test <file-or-directory>                     # narrower tests for the affected behavior
bun run check:dev                                # static checks, tracker and docs; no tests
bun run check:docs                               # local links, ADR format and skill metadata
bun run docs:update                              # synchronize generated ADR index
bun run test:docs                                # documentation checker regression tests
bun run test                                     # all current Bun tests
bunx --no -- oxfmt --check                        # formatting
bunx --no -- oxlint                              # lint
bunx --no -- tsc -b                               # typecheck all workspaces
bunx --no -- knip                                # unused files, exports, and dependencies
env -u NO_COLOR bun run check                     # format → lint → types → Knip → tests
```

`package.json` owns the executable scripts. `bun run check:dev` runs static development checks without tests. Use `test:agent` or `test:coding-agent` for the affected area; these scripts clear `NO_COLOR` and run with four workers. Select a narrower case or file with `bun test <file-or-directory>` and clear `NO_COLOR` for terminal color assertions. `bun run check` is the aggregate validation command; there are no root `build` or `typecheck` scripts. Clear `NO_COLOR` for the aggregate check so terminal color behavior is exercised.

## Code

- Fix the cause in the module that owns the behavior. Deliver the smallest working end-to-end change, then extend it only for requirements in scope.
- Prefer one representation and one execution path. When changing an internal interface, update all repository consumers and remove obsolete code, configuration, tests, and docs in the same change.
- Do not preserve backward compatibility unless the user asks for it.
- Add abstractions for current use cases. Before adding a helper or dependency, inspect existing packages, their APIs, and types; choose the option that reduces total implementation and maintenance cost.
- Keep TypeScript strict. Parse untrusted settings, tool/model JSON, files, and process or wire inputs as `unknown`, then validate and narrow them. Trust typed internal calls; use assertions only with a checked or documented invariant, and explain unavoidable `any`.
- Name the behavior precisely. Comments and JSDoc explain caller obligations, timing, ownership, failure behavior, or a reason the code cannot express. Keep them local and update them with the implementation.
- Fix lint findings and remove unused code. When a rule conflicts with a required library idiom or vendored code, use a narrow, explained exception in the owning configuration.

## Architecture and package conventions

- **Workspace imports.** Internal packages export `src/index.ts` directly and use `workspace:*`; they do not require a runtime build. Use package names across workspaces. Each package extends `tsconfig.base.json`; `tsc -b` checks the project references.
- **Agent modules.** Group code by owned capability, exposing `index.ts` for other modules. Execution rules, state, and resources belong to the capability; Session composes and coordinates them. Agent Core owns behavior independently of frontend presentation.
- **Tools capabilities.** `tools/` owns built-in tools and their associated execution, state, and resource capabilities, grouped by capability. Keep model protocol adapters separate from controllers and registries inside each directory; Session may call capability interfaces directly and assembles the model tool set in `session/tools.ts`. Generic Tool State accepts registered definitions. Before moving capabilities or extracting Session behavior, read [ADR-0011](docs/adr/0011-agent-module-ownership.md) for internal dependency direction, shared support, and the enforced import restrictions.
- **Harness reuse.** Build on the locked pi-durable/pi-ai/pi-mcp APIs, following ADR-0024. Inspect their installed source and types before replacing harness capabilities or assuming upstream behavior.
- **UI layers.** Imports point downward: screens wire Session and pass presentation facts to app components and terminal-independent `view/`. App components and view import Agent Core types only; view has no React, ink, TUI, or Node dependency. TUI uses terminal primitives and design system through `ink/index.ts`; ink has no Agent Core, locale, or upper-layer dependency. Paths and responsibilities: [docs/architecture.md](docs/architecture.md).
- **Runtime-agnostic packages.** `@rukie/shared` uses no Bun, Node, or DOM APIs and depends only on `typebox`; `@rukie/i18n` has the same restriction and depends only on `@rukie/shared`.
- **Locale.** Agent Core stays locale-agnostic. Update both zh and en dictionaries when changing localized copy (ADR-0008).
- **Terminal behavior.** Preserve terminal restoration, reading position, bottom-follow behavior, and small-terminal handling (ADR-0006). Read [packages/coding-agent/src/ink/README.md](packages/coding-agent/src/ink/README.md) before changing renderer APIs or lifecycle behavior.
- **GUI design.** Read [DESIGN.md](DESIGN.md) before creating or changing React DOM components, styles, themes, or layout for desktop or Web; its rules are binding. shadcn/ui's default style is the visual baseline for all components, and beUI contributes motion only; DESIGN.md's GitHub Light/Dark colors, mandatory `text-ui-*` typography scale, and localization rules override them, and design mockups supply layout only. Treat a violation as a defect; when a design need is not covered, update DESIGN.md first instead of adding one-off values. DESIGN.md does not apply to the terminal renderer.
- **Reference code.** dsh-TUI is the design/behavior reference when specified. The ink runtime and its Yoga are the explicitly vendored exception under ADR-0013; preserve the fixed-source diff and document local changes in the renderer README. Keep unrelated visual and interaction behavior intact.
- **Dependencies.** External versions are pinned exactly; update [docs/tech-stack.md](docs/tech-stack.md) and the Bun lockfile with dependency changes. Distinguish installed dependencies from planned stack choices. Keep TypeBox aligned with the locked pi version.

## UI components

Applies to React DOM components for desktop and Web; the terminal renderer keeps its own design system. [DESIGN.md](DESIGN.md) owns how a component looks; this section owns where it comes from.

- **Reuse first.** Use or compose an existing repository component before adding one. Do not replace a working component unless it fails a stated requirement, and do not write custom code for a need a registry or library already covers.
- **Foundation: shadcn/ui.** Standard components, forms, navigation, overlays, and layouts come from shadcn/ui. Load the `shadcn` skill, discover components through its MCP server (`.mcp.json`) or CLI, and install with `bunx --bun shadcn@latest add <name>`.
- **Motion: beUI.** Animated interactions, transitions, and agent execution feedback (streaming, thinking, tool activity, progress) come from beUI. Load the `beui` skill, discover components through its MCP server (`.mcp.json`) or the `@beui` registry, and install with `bunx --bun shadcn@latest add @beui/<name>`. When a beUI component bundles its own primitive for a role shadcn already fills (Button, Select, Popover, Dialog), switch it to the shadcn primitive so each role has one implementation.
- **Specialized libraries.** Code editors, terminals, diffs, and list virtualization use a dedicated, maintained library instead of registry or custom code. Record the choice in [docs/tech-stack.md](docs/tech-stack.md), and in an ADR when it is a lasting architectural trade-off.
- **Custom last.** Write a component only when none of the above fits, and build it from installed primitives.
- **Adapt on install.** Copied registry code becomes repository code: apply DESIGN.md theme tokens and the `text-ui-*` scale, route copy through `@rukie/i18n` (zh and en), and keep TypeScript strict and lint clean. Pin every dependency the CLI adds to an exact version and update [docs/tech-stack.md](docs/tech-stack.md) and the lockfile in the same change.
- **Consistency.** Every component supports keyboard use, visible focus, accessible names, and Light/Dark contrast; every animation honors `prefers-reduced-motion`.
- **Validation.** Check the installed component's props, keyboard and focus behavior, and accessible names against its source, cover the interactions you rely on with tests, then run the GUI browser verification. When you use a source other than the default for the category, or write a custom component, state in one sentence why; record it in the ticket evidence for ticket work.

## Sessions, configuration, and interactions

Read [CONTEXT.md](CONTEXT.md) for Session, Run, Turn, Transcript, Tool State, and Interaction semantics. Read ADR-0003 for storage and ADR-0009 before changing subagent resume or Run Outcome behavior. Keep model-visible inputs reconstructable from the Transcript, and verify affected persisted state after resume.

Read [docs/permission-rules.md](docs/permission-rules.md) before changing permission decisions or matching, and [docs/hooks.md](docs/hooks.md) before changing hook execution. Preserve project trust and credential ownership: provider definitions belong to user settings; project hooks, MCP configuration, and allow rules require a Trusted Project. Plan Mode and Permission Mode are independent.

Frontends supply Interaction callbacks. Headless CLI supplies none: dependent tools are hidden and Agent Core requests use their safe defaults. Test cancellation and missing-callback behavior whenever an interaction changes. Keep credentials and real user settings out of commits and test fixtures.

## Tests and verification

Read [testing strategy and reliability constraints](docs/testing.md) before adding, modifying, reviewing or diagnosing tests. Its tier selection, isolation, synchronization, cleanup and flake rules are binding; `check:test-policy` enforces the mechanical subset.

- Tests live in each package's `tests/`, mirroring `src/`. Cross-concept scenarios live in `tests/e2e/`; reusable fixtures live in `tests/helpers/`.
- Follow the production runtime (ADR-0004): current Bun code uses `bun:test`; Electron main and renderer will use Vitest when introduced.
- Test observable behavior through public entry points. For Agent Core, use `createSession` with the existing fake model helpers; for TUI, use the app `start` helper and injected/headless terminals. Prefer explicit model replies, events, idle/completion signals, or terminal predicates over timing guesses.
- **Time and cleanup.** New or modified timer tests use a virtual clock when the relevant timers share the test process; assert behavior immediately before and at the deadline. Use `startWithClock` for TUI app timer scenarios and restore clocks in `finally`. Synchronize asynchronous work and cleanup on completion promises, events, terminal predicates, or process exit; fixed sleeps are not synchronization. Bound waits so failures terminate with useful diagnostics.
- **Real-time coverage.** Keep real time only when it verifies an actual process, transport, SDK, or runtime timing contract that a virtual clock cannot cover. State that reason beside the wait and use the smallest duration that preserves the contract. A parent-process virtual clock does not advance child-process timers. Keep mocked clocks and global state isolated; do not mark such tests concurrent unless they have independent runtimes.
- **Coverage cost.** Verify large sample counts, retention limits, and state transitions through the owning module's observable interface; use a small representative end-to-end scenario to verify wiring and presentation. Preserve public behavior coverage, using actual Session Runs where required. Parameterize cases only when they exercise distinct behavior; avoid repeating expensive setup for equivalent assertions.
- **Performance evidence.** Inspect focused Bun timings for new or modified tests. For a case taking more than one second, check real waits, repeated rendering, process startup, and fixture cleanup before delivery; optimize avoidable costs or document the required integration cost in delivery evidence. Record before/after timings when optimizing an existing slow test. A larger timeout is a failure bound, not a speed optimization.
- For bug fixes, reproduce the failing public behavior before changing implementation. Cover affected lifecycle, abort, resume, and output paths. Streaming regressions must reproduce the relevant update ordering, including microtask boundaries when they affect the failure.
- Isolate project directories, `homeDir`, settings, credentials, and locale inputs with existing helpers. Tests must leave the user's real configuration and Sessions untouched.
- UI changes need terminal assertions for the affected dimensions and interactions, including resize or small-terminal behavior when relevant. Verify coexisting panels, focus, and reading position when their layout or state changes.
- **GUI browser verification.** When a change to React DOM components, styles, layout, or client wiring is otherwise complete, verify it in a real browser with the `agent-browser` CLI without waiting to be asked. Run it once per deliverable, after focused tests and static checks pass, not after each edit or as the debugging loop; iterate with automated tests instead. Repeat only when a later change alters the verified UI, and then check only the affected screens. Load its workflow first with `agent-browser skills get core` (`agent-browser skills get electron` for the packaged desktop app). Open the browser development mode, exercise the affected interactions, check the console and network for errors, and capture screenshots in Light and Dark and at a narrow width. Report what was checked and attach findings; browser checks supplement automated tests and do not replace them. Use isolated settings and the fake model provider, never real credentials or Sessions, and close the browser session when done.
- **Impact discovery.** Before full verification, identify and update all affected implementations, callers and test consumers, including protocol parsers, test helpers, snapshots and assertions. Full-suite runs are not a substitute for this investigation.
- **Focused verification.** Develop with the smallest affected test set: a case or file, then related files, then the affected package. Expand only for a concrete dependency or cross-module risk; measure performance with a focused reproducer. Full-suite runs are for final acceptance, not the debugging loop.
- **One final full run.** For code delivery, run `env -u NO_COLOR bun run check` once after all known affected tests and static checks pass. It already includes all tests; reuse its result for review, commit and delivery, supplemented by focused checks for later local corrections.
- **Full-suite failures.** Reproduce and diagnose each failure with the smallest relevant test set before deciding what to change. Fix failures caused by the current change; record unrelated failures and explain whether they block delivery rather than automatically expanding the repair scope. Report the full run's actual result; focused passes do not turn a failed full run into a passing one.
- **Rerun threshold.** A later edit does not automatically require another full run. Verify local corrections with focused checks. Repeat full verification only for a concrete shared-infrastructure or cross-module risk that focused checks cannot cover, or a demonstrated suite-wide interaction that requires full-suite reproduction. Do not repeat full verification on the same code state to retry failures or seek reassurance.
- **Rerun evidence.** Before every additional full run, state the previous result and failure cause, which verification evidence the intervening changes invalidate, which focused checks now pass, and why those checks are insufficient. “Code changed,” “ensure safety,” and “final confirmation” alone are not valid reasons.
- For documentation-only changes, run `bun run check:docs`, verify formatting and the diff without running tests. Report commands actually run and any failures or checks that could not run.

## Agent skills

### Issue tracker

Issues and specs live as local Markdown under `.scratch/<feature>/`: one `spec.md` and one numbered file per implementation ticket. Update ticket status and append implementation/verification evidence as work progresses. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Default five-role vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single context: root `CONTEXT.md` plus `docs/adr/`. Update the glossary when terminology changes; record durable architectural decisions as ADRs and surface conflicts with an existing ADR before changing its decision. See [docs/agents/domain.md](docs/agents/domain.md).

## Documentation and integration

- **Dependency order.** Honor ticket dependencies and requested integration order. Parallel work is suitable only for independent work after its shared baseline is verified and delegation is authorized.
- **Single source.** Update affected contracts, examples, and docs with behavior changes. Keep version details in `docs/tech-stack.md`, domain definitions in `CONTEXT.md`, and detailed workflows in their linked documents.

## Git workflow

- **Task branches.** Start features, fixes, refactors, and documentation changes from the latest fetched `origin/main`, or continue the existing branch for the same task. Keep one independent task per branch and PR; follow explicit user instructions for a different base or integration order. Inspect the working tree first and preserve unrelated user changes. Develop on a task branch, never directly on `main`.
- **Branch names.** Use `<type>/<short-kebab-case-description>` with `feat`, `fix`, `refactor`, `docs`, `test`, `perf`, `chore`, `build`, or `ci`; optionally include a ticket identifier before the description. Examples: `feat/custom-models`, `fix/session-resume`, and `docs/agent-git-workflow`. Do not use an agent or tool name as the prefix.
- **Commits.** Complete the applicable verification above, review the diff, and stage only task-owned changes before committing. Follow Conventional Commits; Husky runs lint-staged and commitlint. Review any hook-generated edits and verify affected behavior when needed. Keep hooks enabled; do not bypass checks with `--no-verify` or `HUSKY=0`, or weaken checks to obtain a pass.
- **Pull requests.** When delivering through Git, commit and push the task branch, then open or update its PR targeting `main`. Describe the problem, resulting behavior, verification results, and remaining limitations; link the local spec or tickets when present. Resolve review feedback and confirm required CI checks pass for the latest PR commit; pending, cancelled, skipped, or superseded checks do not establish success.
- **Merge authority.** Leave the verified PR ready for user review. Merge only when the user explicitly authorizes it and required CI and review conditions are satisfied. Use Squash merge by default, with a Conventional Commit PR title representing the complete task. Never push task changes directly to `main` or bypass branch protection.
- **Cleanup and delivery.** After confirming the PR is merged, update local `main` by fast-forward when safe and clean up task branches and temporary worktrees within the user's authorized cleanup scope; preserve unmerged work. Keep ticket evidence and status consistent with development, PR, and merge progress. Report the branch, PR, commit, actual checks, and whether the change is awaiting review or merged.

## Done

The requested behavior works end to end, affected consumers and documentation agree, and the required checks pass. For ticket work, its status and verification evidence match the delivered result; complete the [ADR coverage review](docs/agents/issue-tracker.md#adr-coverage-before-delivery) before closing the spec. Report what changed, what was verified, and any remaining limitation; claim completion only from current evidence.

## Editing these instructions

`AGENTS.md` is the authoritative file. Root `CLAUDE.md` is a relative symlink to `AGENTS.md`; edit the target and preserve the link. Keep rules self-contained, disclose detailed reference material through task-specific links, and remove stale or duplicated guidance.
