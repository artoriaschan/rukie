# Chat presentation delivery

## Scope and reproduced failures

- Logo was adjacent to the first committed input; terminal assertion reproduced the missing empty row.
- Settled thinking and ToolSearch had an extra empty row; terminal assertion reproduced it.
- With storage admission held at a completion barrier, the prompt cleared without a corresponding user message in both 60×40 and 60×12 terminals.
- MCP headers duplicated the protocol name, and cards without declared views displayed argument JSON instead of readable MCP identity.

## Implementation and review

- Chat owns row spacing; thinking directly precedes its tool card. Other blocks retain their gap.
- Conversation projection displays accepted input immediately, retains it through snapshots, and reconciles matching text and image content with committed human messages. Rejection/failure clears the preview. The pending submission's abort signal reaches Session admission.
- Preview entries stay outside Transcript. Busy rejection produces no preview; Hook rejection and admission cancellation remove it.
- MCP title follows dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4`: bold server followed by `› tool`, without duplicating the wire name. Existing gutter, three-line fold, 400-line expansion, error and hover interactions are reused. Rendering, tooltip and transcript search share full header presentation.
- No Agent Core or storage contract changes. ADR-0006 continues to own terminal reading/focus behavior; frontend-only preview follows existing local projection ownership. No new architectural decision required.

## Verification

- Initial message-flow reproduction: four failing cases; all four pass after the change.
- Initial MCP header reproduction: two failing cases; declared/missing-view identities now pass, including expansion, resize and errors.
- Related suite: 45 passed, 0 failed across nine files, 1,362 assertions, 7.32 s; thinking, tool views/headers, transcript search, conversation and mixed cold Resume.
- Final local changes: 12 passed, 0 failed, 1,056 assertions, 0.999 s; admission preview, refusal/abort and MCP cards.
- `bun run check:dev` and `git diff --check` passed.
- First aggregate: 3,153 passed, 5 failed, 17,989 assertions, 288 files, 125.36 s.
  - New Logo spacing invalidated an absolute-row Resume assertion; changed it to retained-content and existing layout assertions.
  - New spacing exposed a caught-up text cursor race: paint could precede its passive completion effect. Isolated baseline passed; adding spacing reproduced failure. Prefix updates now preserve caught-up completion before extending total.
  - Passing the pending-input signal into Run accidentally made frontend close interrupt resumable work. Close now cancels only unstarted input; explicit interrupt still aborts the active Run.
  - The future-collision subagent history case timed out in the aggregate; the focused file passed all three cases. This previously observed intermittent failure was not changed.
- Correction checks: 26 passed, 0 failed, 214 assertions, five files, 4.53 s; includes messages, smooth reveal, Resume, exit/Question recovery and subagent history.
- Repeat aggregate is justified by shared smooth text behavior and durable shutdown semantics; these invalidate cross-component and lifecycle evidence from the first aggregate. Final aggregate passed: 3,158 tests, 0 failures, 18,015 assertions across 288 files, 118.36 s.
