import { readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface PermissionPath {
  resolvedPath: string;
  realPath: string;
}

function expandHome(path: string, homeDir: string): string {
  return path.startsWith("~/") ? resolve(homeDir, path.slice(2)) : path;
}

/** Filesystem boundary: resolve missing leaves through their nearest existing ancestor. */
export function resolvePermissionPath({
  toolName,
  args,
  cwd,
  homeDir,
}: {
  toolName: string;
  args: unknown;
  cwd: string;
  homeDir: string;
}): PermissionPath | undefined {
  if (!["read", "edit", "write", "glob", "grep"].includes(toolName)) return undefined;
  const path =
    typeof args === "object" && args !== null && "path" in args && typeof args.path === "string"
      ? args.path
      : toolName === "glob" || toolName === "grep"
        ? cwd
        : undefined;
  if (path === undefined) return undefined;
  const resolvedPath = resolve(cwd, expandHome(path, homeDir));
  let ancestor = resolvedPath;
  const remaining: string[] = [];
  for (;;) {
    try {
      return { resolvedPath, realPath: resolve(realpathSync(ancestor), ...remaining) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      // A dangling symlink is still an existing path component. Follow its
      // destination before looking for an ancestor, including write's new leaf.
      try {
        ancestor = resolve(dirname(ancestor), readlinkSync(ancestor));
        continue;
      } catch (linkError) {
        const linkCode = (linkError as NodeJS.ErrnoException).code;
        if (linkCode !== "ENOENT" && linkCode !== "ENOTDIR" && linkCode !== "EINVAL")
          throw linkError;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      remaining.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

/** Pure matching: restrictions see both spellings; grants see only the real target. */
export function matchesPermissionPath(
  pattern: string,
  decision: "allow" | "ask" | "deny",
  target: PermissionPath,
  cwd: string,
  homeDir: string,
): boolean {
  const matcher = new Bun.Glob(resolve(cwd, expandHome(pattern, homeDir)));
  return (
    matcher.match(target.realPath) || (decision !== "allow" && matcher.match(target.resolvedPath))
  );
}
