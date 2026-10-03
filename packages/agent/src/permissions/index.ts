import type { PermissionMode } from "@neant/shared";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionOptions {
  mode: PermissionMode;
  toolName: string;
  allowTools?: readonly string[];
}

/** Pure policy; frontends decide how to handle `ask`. */
export function decidePermission({
  mode,
  toolName,
  allowTools,
}: PermissionOptions): PermissionDecision {
  if (mode === "full-access" || ["read", "glob", "grep", "skill"].includes(toolName))
    return "allow";
  // auto-review follows ask until Permission Review is wired into the Session.
  return allowTools?.some((pattern) => new Bun.Glob(pattern).match(toolName)) ? "allow" : "ask";
}
