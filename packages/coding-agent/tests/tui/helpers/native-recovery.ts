import { join } from "node:path";

/** Runtime-load the shared fixture without adding Agent tests to this workspace's TS project. */
export async function crashUnsafeEffect(root: string, child = false) {
  const fixture: {
    crashUnsafeEffect(
      root: string,
      child?: boolean,
    ): Promise<{ sessionId: string; childId: string | undefined; effectModifiedAt: number }>;
  } = await import(join(import.meta.dir, "../../../../agent/tests/helpers/native-recovery.ts"));
  return fixture.crashUnsafeEffect(root, child);
}
