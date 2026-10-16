# Composer final check: child startup timeouts

State inspected: HEAD `630e7733`, product source `49bc9dd1`, base `71802c6e`. Read-only repository investigation; no source or test edits and no worktree created.

Original check log: `/var/folders/ql/gqv08x1d593_4fssr6n92gq80000gn/T/rukie-composer-final-jbw9awqo/check.log`.

Original isolated HOME: `/var/folders/ql/gqv08x1d593_4fssr6n92gq80000gn/T/rukie-composer-final-jbw9awqo/home`.

## Original failure retained

14 child fixtures failed: lifecycle exit/SIGINT/SIGTERM/uncaught (4 runner timeouts at 5s; teardown exit 143 unhandled rejection), startup NO_COLOR/FORCE_COLOR (8 execFile timeouts at 2s, empty stdout/stderr), and ordinary/ConPTY same-grid resize (2 execFile timeouts at 2s). The fullcheck remains recorded as failed; incremental recovery does not make it aggregate green.

## Minimal observations

1. Same original HOME, `rtk proxy env -u NO_COLOR HOME=<original-home> bun test packages/coding-agent/tests/ink/terminal/lifecycle.test.tsx -t 'actual child exit restores'`: 1 pass, 12 filtered, 0 fail; 4483.40ms case, 4.57s total. This passed narrowly and did not alone reproduce the 5s failure.
2. Same environment, `rtk proxy env -u NO_COLOR HOME=<original-home> bun test packages/coding-agent/tests/ink/primitives/text-style.test.tsx -t 'startup NO_COLOR="1" respects #12ab34'`: 1 pass, 18 filtered, 0 fail; 116.40ms case, 200ms total. Timing recovery alone was not causal proof.
3. Minimal external-temp TSX imports React by its absolute installed path, prints USER_ENTRY, then constructs `<span>ok</span>`. `bun --no-install <temp>/minimal.tsx` fails before USER_ENTRY in 19.98ms: `Cannot find module 'react/jsx-dev-runtime'`. Default invocation passes in 21.06ms using existing cache. Explicit React import does not resolve automatic JSX runtime imports.
4. Controlled cold-cache comparison: preserve original HOME; set BUN_INSTALL_CACHE_DIR to a fresh empty directory. Default automatic JSX variant times out after 3007.99ms with empty stdout/stderr. Identical source adding only `/** @jsxRuntime classic */` passes in 20.47ms with USER_ENTRY/span output. This pragma existed only in the throwaway probe, never repository source.
5. Environment-only resolution probe: identical automatic JSX source, fresh empty BUN_INSTALL_CACHE_DIR, `bun --no-install`, and NODE_PATH pointing at this checkout's `packages/coding-agent/node_modules` passes in 26.09ms. This establishes repo runtime resolution without relying on auto-install or network.

Ranked hypotheses before controlled probes: external-temp automatic JSX resolution/auto-install, renderer child initialization, resource contention only. Minimal TSX has no renderer yet reproduces the startup stall with a cold cache. Exact registry/network behavior during the original fullcheck was not captured, so no specific registry outage is claimed.

## Causality and scope

The three ink fixture files, ink production source, root/coding-agent package manifests, bunfig, and relevant tsconfigs have zero diff against `71802c6e`. Lockfile changes add Lexical/UI dependencies without changing React or ink dependency versions. Generated TSX lives outside repo/node_modules ancestry. Inherited BUN_INSTALL already points to `/Users/artorias_chan/.bun`; isolated HOME alone is not established as the cause.

Classification: pre-existing child-fixture dependency on Bun's automatic JSX package resolution, exposed by cache/network state. No composer task source causality found. Kept unrelated ink fixtures unchanged per parent instruction.

## Authorized incremental verification

Previous evidence: 14 original child failures. Environment correction: tested NODE_PATH resolves locked JSX runtime; explicit public Bun cache path avoids ambiguity while HOME remains isolated. Minimum scope: exactly those 14 cases, once.

```sh
rtk proxy bash -o pipefail -c 'env -u NO_COLOR HOME=/var/folders/ql/gqv08x1d593_4fssr6n92gq80000gn/T/rukie-composer-final-jbw9awqo/home BUN_INSTALL_CACHE_DIR=/Users/artorias_chan/.bun/install/cache NODE_PATH=/Users/artorias_chan/.codex/worktrees/57c2/rukie/packages/coding-agent/node_modules bun test packages/coding-agent/tests/ink/terminal/lifecycle.test.tsx packages/coding-agent/tests/ink/primitives/text-style.test.tsx packages/coding-agent/tests/ink/hooks/resize.test.tsx -t "actual child|startup (NO_COLOR|FORCE_COLOR)|same-grid resize" 2>&1 | tee /tmp/rukie-composer-child-incremental.log'
```

Result: exit 0, 14 pass, 21 filtered, 0 fail, 249 expectations, 1.489s runner total; cases 94.92–111.88ms. Log: `/tmp/rukie-composer-child-incremental.log`. Recovery covers only these cases with corrected resolution environment; original fullcheck remains failed and other stages belong to parent coordination.

## Cleanup

No repository changes or baseline worktree/branch. Every spawned child was awaited to actual close by execFile, including timeout SIGTERM. Throwaway TSX/cache directories removed after recording observations; no owned child remains.
