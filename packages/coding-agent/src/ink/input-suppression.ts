/**
 * Input suppression window for terminal handoffs (issue #123): when stdin is
 * handed to an external TUI (full-screen editor) and back, the tty can
 * deliver a burst of bytes that are NOT user keystrokes — the editor's
 * rmcup/mode-restore replies, CPR/DECRPM query responses, mouse-event
 * fragments, or keystrokes typed into the canonical line buffer while raw
 * mode was off. Parsed as input they are destructive: a stray ESC reads as
 * the escape key (which CLEARS a non-empty prompt) and the rest lands as
 * text garbage.
 *
 * resumeStdin() drains what is already buffered; this module covers what
 * arrives LATE (terminal replies are async). use-input checks the window at
 * the single choke point every component's input flows through, so no
 * listener (Chat's ctrl+c/esc handling included) sees the burst.
 */

/** Each renderer owns its terminal handoff quarantine. */
export function createInputSuppression() {
  let suppressedUntil = 0
  return {
    suppressFor(ms: number): void {
      suppressedUntil = Math.max(suppressedUntil, Date.now() + ms)
    },
    isSuppressed(): boolean {
      return Date.now() < suppressedUntil
    },
  }
}
