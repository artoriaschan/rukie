import type { PlanSnapshot } from "./state.ts";

/**
 * Shared Plan Mode state machine. Session supplies the persisted snapshot, the write and the
 * event coordination; the controller owns the active/entered projection, the write queue,
 * the latest-revision rollback and the restore projection.
 *
 * Child Sessions reuse the parent's controller instance instead of building one: they own
 * no snapshot, so `hasEntered` must come from this shared projection, never from a child
 * lookup of its own Tool State.
 */
export interface PlanModeController {
  getActive(): boolean;
  hasEntered(): boolean;
  setMode(on: boolean): Promise<void>;
  /** Resolves when every queued switch has settled; never waits on their notifications. */
  settleWrites(): Promise<void>;
  /** Re-derive the projection after Tool State replay, mutating this shared instance. */
  restore(): void;
}

export function createPlanModeController(options: {
  /** Last successfully persisted snapshot, or `undefined` before the first write. */
  getSnapshot(): unknown;
  /** Persist one switch. Session saves the baseline first and serializes Session Store access. */
  persist(active: boolean): Promise<void>;
  /** Deliver the state event. Kept outside the write queue so observers may re-enter. */
  changed(value: PlanSnapshot): void | Promise<void>;
}): PlanModeController {
  const snapshot = () => options.getSnapshot() as PlanSnapshot | undefined;
  const initial = snapshot();
  let active = initial?.active ?? false;
  let entered = initial !== undefined;
  let writes = Promise.resolve();
  let revision = 0;
  return {
    getActive: () => active,
    hasEntered: () => entered,
    setMode(on: boolean): Promise<void> {
      // A same-value call waits on the writes already queued, and never rejects with them.
      if (active === on) return writes;
      // Switch in memory first, then serialize the write behind the queued revisions.
      active = on;
      entered = true;
      const current = ++revision;
      const write = writes.then(() => options.persist(on));
      const persisted = write.catch((error: unknown) => {
        // Only the latest revision restores the projection, from the snapshot that
        // actually persisted, so an earlier failure cannot undo a later switch.
        if (current === revision) {
          const value = snapshot();
          active = value?.active ?? false;
          entered = value !== undefined;
        }
        throw error;
      });
      // The queue swallows failures so later switches still run; the caller still sees them.
      writes = persisted.then(
        () => {},
        () => {},
      );
      // The notification follows the write for its own caller only.
      return persisted.then(async () => options.changed({ active: on }));
    },
    settleWrites: () => writes,
    /** Re-derive the projection after Tool State replay, mutating this shared instance. */
    restore() {
      const value = snapshot();
      active = value?.active ?? false;
      entered = value !== undefined;
    },
  };
}
