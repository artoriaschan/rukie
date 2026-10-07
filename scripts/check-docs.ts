// Checks maintained Markdown, ADR format and repository skill discovery metadata.
import { YAML } from "bun";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parseArgs } from "node:util";

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  identifier?: string;
  depth?: number;
  position?: { start: { line: number } };
}

let options: { root?: string; write?: boolean };
try {
  options = parseArgs({
    args: process.argv.slice(2),
    options: { root: { type: "string" }, write: { type: "boolean" } },
  }).values;
} catch {
  console.error("Usage: bun scripts/check-docs.ts [--root <repository>] [--write]");
  process.exit(1);
}
const root = resolve(options.root ?? join(import.meta.dir, ".."));
const errors: string[] = [];
const parsed = new Map<string, MarkdownNode>();

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function markdown(path: string): MarkdownNode {
  let tree = parsed.get(path);
  if (!tree) {
    const body = readFileSync(path, "utf8").replace(
      /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
      (header) => header.replace(/[^\r\n]/g, " "),
    );
    tree = fromMarkdown(body);
    parsed.set(path, tree);
  }
  return tree;
}

function text(node: MarkdownNode): string {
  return node.type === "html" ? "" : (node.value ?? (node.children ?? []).map(text).join(""));
}

function anchors(tree: MarkdownNode): Set<string> {
  const values = new Set<string>();
  walk(tree, (node) => {
    if (node.type === "heading") {
      const slug = text(node)
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
        .replace(/ /g, "-");
      let anchor = slug;
      for (let suffix = 1; values.has(anchor); suffix++) anchor = `${slug}-${suffix}`;
      values.add(anchor);
    }
    if (node.type === "html") {
      for (const match of (node.value ?? "").matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) {
        if (match[1]) values.add(match[1]);
      }
    }
  });
  return values;
}

function links(path: string) {
  const tree = markdown(path);
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    // CommonMark resolves duplicate reference labels to the first definition.
    if (
      node.type === "definition" &&
      node.identifier &&
      node.url &&
      !definitions.has(node.identifier)
    )
      definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    const url =
      node.type === "link" || node.type === "image"
        ? node.url
        : node.type === "linkReference" || node.type === "imageReference"
          ? definitions.get(node.identifier ?? "")
          : undefined;
    if (!url || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//")) return;
    const location = `${relative(root, path)}:${node.position?.start.line ?? 1}`;
    try {
      const hash = url.indexOf("#");
      const file = decodeURIComponent((hash < 0 ? url : url.slice(0, hash)).split("?")[0] ?? "");
      const fragment = hash < 0 ? "" : decodeURIComponent(url.slice(hash + 1));
      const target = file ? resolve(dirname(path), file) : path;
      if (isAbsolute(file) || relative(root, target).split(/[\\/]/)[0] === "..") {
        errors.push(`${location}: use a repository-relative link: ${url}`);
      } else if (!existsSync(target)) {
        errors.push(`${location}: missing link target ${url}`);
      } else if (
        fragment &&
        target.endsWith(".md") &&
        statSync(target).isFile() &&
        !anchors(markdown(target)).has(fragment)
      ) {
        errors.push(`${location}: missing anchor #${fragment} in ${relative(root, target)}`);
      }
    } catch (error) {
      errors.push(
        `${location}: invalid link encoding or unreadable target ${url}: ${String(error)}`,
      );
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadata(path: string): Record<string, unknown> | undefined {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(readFileSync(path, "utf8"));
  if (!header) {
    errors.push(`${relative(root, path)}: missing YAML frontmatter`);
    return;
  }
  try {
    const value: unknown = YAML.parse(header[1] ?? "");
    if (isRecord(value)) return value;
    errors.push(`${relative(root, path)}: YAML metadata must be an object`);
  } catch (error) {
    errors.push(`${relative(root, path)}: invalid YAML: ${String(error)}`);
  }
  return;
}

function adr(path: string) {
  const name = relative(root, path);
  if (!/^\d{4}-[a-z\d]+(?:-[a-z\d]+)*\.md$/.test(basename(path)))
    errors.push(`${name}: expected NNNN-topic.md`);
  const status = metadata(path)?.status;
  if (
    typeof status !== "string" ||
    !["proposed", "accepted", "rejected", "superseded"].includes(status)
  )
    errors.push(`${name}: invalid decision status`);
  const sections = new Map<string, MarkdownNode>();
  const headings: MarkdownNode[] = [];
  const children = markdown(path).children ?? [];
  for (const node of children) {
    if (node.type === "heading") headings.push(node);
  }
  if (headings.filter((node) => node.depth === 1).length !== 1)
    errors.push(`${name}: expected one title`);
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node?.type !== "heading" || node.depth !== 2) continue;
    const body: MarkdownNode[] = [];
    for (let j = i + 1; j < children.length; j++) {
      const next = children[j];
      if (!next || (next.type === "heading" && (next.depth ?? 6) <= 2)) break;
      body.push(next);
    }
    sections.set(text(node), { type: "section", children: body });
  }
  for (const heading of ["问题", "决定", "备选方案", "影响"]) {
    const section = sections.get(heading);
    if (!section || !text(section).trim())
      errors.push(`${name}: missing or empty section ${heading}`);
  }
  return {
    path,
    title: text(headings.find((node) => node.depth === 1) ?? { type: "text" }),
    status,
  };
}

function decisionIndex(decisions: ReturnType<typeof adr>[]) {
  if (!existsSync(join(root, "docs/adr")) || errors.length) return;
  const path = join(root, "docs/adr/README.md");
  const start = "<!-- ADR_INDEX_START -->";
  const end = "<!-- ADR_INDEX_END -->";
  const body = existsSync(path) ? readFileSync(path, "utf8") : "";
  const first = body.indexOf(start);
  const last = body.indexOf(end);
  if (
    first < 0 ||
    last <= first ||
    body.indexOf(start, first + start.length) >= 0 ||
    body.indexOf(end, last + end.length) >= 0
  ) {
    errors.push("docs/adr/README.md: expected one ADR_INDEX_START / ADR_INDEX_END region");
    return;
  }
  const rows = decisions
    .sort((a, b) => basename(a.path).localeCompare(basename(b.path)))
    .map(({ path: decision, title, status }) => {
      const label = `${basename(decision).slice(0, 4)} ${title}`.replace(/[\\`*_[\]<>]/g, "\\$&");
      return `- [${label}](${basename(decision)}) — \`${String(status)}\``;
    });
  const updated =
    body.slice(0, first + start.length) + `\n\n${rows.join("\n")}\n\n` + body.slice(last);
  if (body === updated) return;
  if (!options.write) {
    errors.push("docs/adr/README.md: stale decision index; run bun run docs:update");
    return;
  }
  writeFileSync(path, updated);
  parsed.delete(path);
}

function skill(path: string) {
  const value = metadata(path);
  if (!value) return;
  const name = value.name;
  if (
    typeof name !== "string" ||
    name.length > 64 ||
    !/^[a-z\d]+(?:-[a-z\d]+)*$/.test(name) ||
    name !== basename(dirname(path))
  )
    errors.push(`${relative(root, path)}: name must match the skill directory`);
  if (typeof value.description !== "string" || !value.description.trim())
    errors.push(`${relative(root, path)}: description must be a nonempty string`);
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git", "dist"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() && path.endsWith(".md") ? [path] : [];
  });
}

const documents = [
  ...readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(root, entry.name)),
  ...["docs", "packages", ".agents/skills"].flatMap((dir) => files(join(root, dir))),
];
const decisions = documents
  .filter(
    (path) =>
      dirname(path) === join(root, "docs/adr") &&
      !["README.md", "AGENTS.md"].includes(basename(path)),
  )
  .map(adr);
decisionIndex(decisions);
for (const path of documents) {
  links(path);
  if (basename(path) === "SKILL.md" && relative(root, path).startsWith(".agents/skills/"))
    skill(path);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Documentation checks passed (${documents.length} Markdown files).`);
