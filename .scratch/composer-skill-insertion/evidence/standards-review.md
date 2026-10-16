## Standards

Reviewed `git diff 71802c6e...630e7733` (commit list verified with `git log`), including Host ownership, Session/Frontend wiring, editor/clipboard presentation, tests and maintained contracts. Read the verification record and ticket evidence; no tests or static checks were rerun.

Hard documented-standard violations:

1. **[P2] Register timeout-safe cleanup for the new MCP fixtures.** `packages/agent/tests/e2e/mcp-health.test.ts:74–111` owns a real stdio Host and global fake timers, but cleanup exists only in `finally`; a suspended `changed.promise` or `prepareRun()` can outlive the runner timeout and leave children/clocks active for later cases. The same pattern appears throughout this new file and `packages/agent/tests/e2e/mcp-host.test.ts` (including real Sessions at lines 21–35). Neither `tempDirs` nor `mcpOAuthServer` installs a timeout cleanup hook. This violates `docs/testing.md:34`: register release immediately and use Bun `onTestFinished` with the same idempotent cleanup Promise; `finally` cannot be the only entry. Register an owner before acquisition, include barrier release and late initialization, close owned resources before restoring clocks, and call the same cleanup from `finally`.

2. **[P2] Use the documented menu-row radius.** `packages/ui/src/components/agents/skill-picker.css:24` sets `.composer-insertion-option { border-radius: 6px; }`. `DESIGN.md:207,233–235` requires standard 32px menu/Select rows to use MD/8px corners inside the LG/12px shell. The insertion-specific section retains the existing menu roles and supplies no 6px row exception. Set this shared row radius to 8px and verify its selectable and MCP detail consumers together.

Judgment-only smell baseline: no additional actionable smell finding. Existing component reuse and the custom Lexical listbox seam are justified by the recorded editor-focus requirement. The independently reproduced skill discovery root mismatch belongs to the Spec report and is not duplicated here.

Total: 2 Standards findings; worst: timeout cleanup can contaminate subsequent tests and retain processes.
