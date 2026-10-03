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
}: PermissionOptions): PermissionDecision | "review" {
  if (
    mode === "full-access" ||
    ["read", "glob", "grep", "skill", "ask_user_question", "todo_write"].includes(toolName)
  )
    return "allow";
  if (allowTools?.some((pattern) => new Bun.Glob(pattern).match(toolName))) return "allow";
  return mode === "auto-review" ? "review" : "ask";
}
