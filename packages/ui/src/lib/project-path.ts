/** Abbreviate only the supplied home identity and its separator-boundary descendants. */
export function projectPath(path: string, homeDir: string | null): string {
  if (!homeDir) return path;
  const windows = /^[a-z]:[\\/]/i.test(homeDir) || homeDir.startsWith("\\\\");
  const compare = (value: string) => (windows ? value.replaceAll("\\", "/").toLowerCase() : value);
  const normalized = compare(path);
  const identity = compare(homeDir).replace(/\/+$/, "") || "/";
  if (normalized === identity || normalized === `${identity}/`) return "~";
  const boundary = identity === "/" ? "/" : `${identity}/`;
  if (!normalized.startsWith(boundary)) return path;
  return `~/${windows ? path.slice(boundary.length).replaceAll("\\", "/") : path.slice(boundary.length)}`;
}
