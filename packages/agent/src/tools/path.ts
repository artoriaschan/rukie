import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Match pi's file tool spellings before permission checks and execution share the argument. */
export function prepareFileToolPath(
  path: string,
  read: boolean,
  cwd: string,
  homeDir: string,
): string {
  let normalized = path.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  if (normalized === "~") normalized = homeDir;
  else if (
    normalized.startsWith("~/") ||
    (process.platform === "win32" && normalized.startsWith("~\\"))
  )
    normalized = join(homeDir, normalized.slice(2));
  else if (normalized.startsWith("file://")) {
    try {
      normalized = fileURLToPath(normalized);
    } catch {
      /* pi leaves malformed URLs as ordinary paths. */
    }
  }
  const absolute = resolve(cwd, normalized);
  if (!read) return absolute;
  const variants = [
    absolute,
    absolute.replace(/ (AM|PM)\./gi, "\u202F$1."),
    absolute.normalize("NFD"),
    absolute.replace(/'/g, "\u2019"),
    absolute.normalize("NFD").replace(/'/g, "\u2019"),
  ];
  for (const candidate of new Set(variants)) {
    try {
      // pi env.exists uses lstat: a dangling symlink is an existing first candidate.
      lstatSync(candidate);
      return candidate;
    } catch (error) {
      // Only not-found advances pi's read fallbacks. Leave other failures to execute,
      // so its established filesystem error result remains unchanged.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return candidate;
    }
  }
  return absolute;
}
