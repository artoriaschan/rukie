// Validates `.scratch/` tracker metadata (see docs/agents/issue-tracker.md).
// `--report` prints per-feature progress instead of only failing on errors.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", ".scratch");
const statuses = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "claimed",
  "resolved",
  "wontfix",
]);
const closed = new Set(["resolved", "wontfix"]);
const errors: string[] = [];
const report: string[] = [];

function status(path: string): string | undefined {
  const lines = readFileSync(path, "utf8").match(/^Status: .*$/gm) ?? [];
  const value = lines[0]?.slice("Status: ".length).trim();
  if (lines.length !== 1)
    errors.push(`${path}: expected one "Status:" line, found ${lines.length}`);
  else if (value === undefined || !statuses.has(value))
    errors.push(`${path}: unknown status "${value}"`);
  return value;
}

for (const feature of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  if (!feature.isDirectory()) continue;
  const dir = join(root, feature.name);
  const specPath = join(dir, "spec.md");
  const spec = existsSync(specPath) ? status(specPath) : undefined;
  const issuesDir = join(dir, "issues");
  const files = existsSync(issuesDir)
    ? readdirSync(issuesDir).filter((f) => f.endsWith(".md"))
    : [];
  const numbers = new Set(files.map((f) => f.slice(0, 2)));
  const open: string[] = [];
  for (const file of files) {
    const path = join(issuesDir, file);
    const value = status(path);
    if (value !== undefined && !closed.has(value)) open.push(`${file.slice(0, 2)}(${value})`);
    const blocked = readFileSync(path, "utf8").match(/^Blocked by:(.*)$/m)?.[1] ?? "";
    for (const ref of blocked.match(/\b\d{2}\b/g) ?? []) {
      if (!numbers.has(ref)) errors.push(`${path}: "Blocked by" references missing ticket ${ref}`);
    }
  }
  if (files.length > 0 && spec !== undefined) {
    if (open.length === 0 && !closed.has(spec))
      errors.push(`${specPath}: all tickets closed but spec is "${spec}"`);
    if (open.length > 0 && closed.has(spec))
      errors.push(`${specPath}: spec is "${spec}" but tickets ${open.join(", ")} are open`);
  }
  const progress = files.length > 0 ? ` ${files.length - open.length}/${files.length} closed` : "";
  report.push(
    `${feature.name}: spec=${spec ?? "-"}${progress}${open.length > 0 ? ` open: ${open.join(" ")}` : ""}`,
  );
}

if (process.argv.includes("--report")) console.log(report.join("\n"));
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
