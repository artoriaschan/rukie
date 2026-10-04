import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

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
  let realPath = "/";
  const remaining = resolvedPath.split("/");
  let links = 0;
  while (remaining.length > 0) {
    const component = remaining.shift()!;
    if (!component || component === ".") continue;
    if (component === "..") {
      realPath = dirname(realPath);
      continue;
    }
    const candidate = `${realPath === "/" ? "" : realPath}/${component}`;
    try {
      if (lstatSync(candidate).isSymbolicLink()) {
        if (++links > 40)
          throw Object.assign(
            new Error(`ELOOP: too many symbolic links, realpath '${resolvedPath}'`),
            {
              code: "ELOOP",
            },
          );
        const destination = readlinkSync(candidate);
        if (isAbsolute(destination)) realPath = "/";
        // Bun realpath also folds ../ before resolving links. Expand each link
        // ourselves so through/../leaf visits through's real destination first.
        remaining.unshift(...destination.split("/"));
      } else {
        realPath = realpathSync(candidate);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      // The canonical existing prefix is retained while missing leaves append.
      realPath = candidate;
    }
  }
  return { resolvedPath, realPath };
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
