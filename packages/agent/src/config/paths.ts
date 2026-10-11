import { isAbsolute, join } from "node:path";

/** Configuration ownership is independent of the home used for tool and permission paths. */
export interface UserDataOptions {
  homeDir: string;
  /** Explicit application root; omitting it selects the terminal's existing user sources. */
  dataRoot?: string;
}

export function userDataDirectory(options: UserDataOptions): string {
  if (options.dataRoot !== undefined) {
    if (!isAbsolute(options.dataRoot)) throw new Error("Application dataRoot must be absolute.");
    return options.dataRoot;
  }
  return join(options.homeDir, ".rukie");
}

export function contentDirectories(
  cwd: string,
  options: UserDataOptions,
  kind: "skills" | "agents",
): string[] {
  const namespaces = [".rukie", ".claude", ".agents"];
  return [
    ...(options.dataRoot === undefined
      ? namespaces.map((namespace) => join(options.homeDir, namespace, kind))
      : [join(userDataDirectory(options), kind)]),
    ...namespaces.map((namespace) => join(cwd, namespace, kind)),
  ];
}
