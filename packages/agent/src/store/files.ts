import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

/**
 * Storage filesystem whose successful append includes flushing the appended file.
 * Native JSONL fsync flushes sidecars but does not flush each main commit marker.
 * A failed flush rejects acknowledgement; the preceding append may still exist.
 */
export class CommittedFiles extends NodeExecutionEnv {
  override async appendFile(...args: Parameters<NodeExecutionEnv["appendFile"]>) {
    const result = await super.appendFile(...args);
    return result.ok ? this.flushFile(args[0], args[2]) : result;
  }
}
