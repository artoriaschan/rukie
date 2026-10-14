import { relative, isAbsolute, sep } from "node:path";
import { resolvePermissionPath } from "./path.ts";

/** Session-owned roots; children share the parent's live scope. */
export interface SessionAccessScope {
  readWrite: readonly string[];
  readOnly: readonly string[];
}

export function isWithinAccessScope(
  toolName: string,
  args: unknown,
  cwd: string,
  homeDir: string,
  scope: SessionAccessScope,
): boolean {
  const target = resolvePermissionPath({ toolName, args, cwd, homeDir });
  if (!target) return false;
  const roots = ["read", "glob", "grep"].includes(toolName)
    ? [...scope.readWrite, ...scope.readOnly]
    : scope.readWrite;
  return roots.some((path) => {
    const root = resolvePermissionPath({ toolName: "read", args: { path }, cwd, homeDir })!;
    const child = relative(root.realPath, target.realPath);
    return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
  });
}
