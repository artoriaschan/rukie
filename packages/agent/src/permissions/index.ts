export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionOptions {
  allowTools?: readonly string[];
  yolo?: boolean;
}

/** Pure policy; frontends decide how to handle `ask`. */
export function decidePermission(toolName: string, options: PermissionOptions): PermissionDecision {
  if (options.yolo || ["read", "glob", "grep", "skill"].includes(toolName)) return "allow";
  return options.allowTools?.some((pattern) => new Bun.Glob(pattern).match(toolName))
    ? "allow"
    : "ask";
}
