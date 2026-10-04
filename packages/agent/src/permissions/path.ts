import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

export interface PermissionPath {
  resolvedPath: string;
  realPath: string;
}

function expandHome(path: string, homeDir: string): string {
  return path.startsWith("~/") ? resolve(homeDir, path.slice(2)) : path;
}

function pathComponents(path: string): string[] {
  // Windows accepts both separators; on POSIX a backslash is a filename byte.
  return sep === "\\" ? path.split(/[\\/]/) : path.split(sep);
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
  let realPath = parse(resolvedPath).root;
  const remaining = pathComponents(resolvedPath.slice(realPath.length));
  let links = 0;
  while (remaining.length > 0) {
    const component = remaining.shift()!;
    if (!component || component === ".") continue;
    if (component === "..") {
      realPath = dirname(realPath);
      continue;
    }
    const candidate = join(realPath, component);
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
        const absolute = isAbsolute(destination);
        if (absolute) realPath = parse(destination).root;
        // Bun realpath also folds ../ before resolving links. Expand each link
        // ourselves so through/../leaf visits through's real destination first.
        remaining.unshift(
          ...pathComponents(absolute ? destination.slice(realPath.length) : destination),
        );
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
