import { truncateHead } from "./runtime.ts";
import { Value } from "typebox/value";
import type { PresentedTool } from "./presentation.ts";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import { Type } from "typebox";

const facts = Type.Object({ paths: Type.Array(Type.String()), total: Type.Number() });

const schema = Type.Object({
  pattern: Type.String({ description: "File glob pattern relative to path (e.g. **/*.ts)." }),
  path: Type.Optional(Type.String({ description: "Directory to search; defaults to cwd." })),
});

interface IgnoreRules {
  directory: string;
  matcher: Ignore;
}

async function loadRules(directory: string, inherited: IgnoreRules[]) {
  const file = Bun.file(join(directory, ".gitignore"));
  return (await file.exists())
    ? [...inherited, { directory, matcher: ignore().add(await file.text()) }]
    : inherited;
}

function isIgnored(absolute: string, directory: boolean, rules: IgnoreRules[]) {
  let ignored = false;
  for (const rule of rules) {
    const local = relative(rule.directory, absolute).split(sep).join("/") + (directory ? "/" : "");
    const decision = rule.matcher.test(local);
    if (decision.ignored) ignored = true;
    if (decision.unignored) ignored = false;
  }
  return ignored;
}

async function repositoryRoot(
  directory: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted();
  try {
    // .git can be a directory or a worktree's pointer file.
    await lstat(join(directory, ".git"));
    return directory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(directory);
  return parent === directory ? undefined : repositoryRoot(parent, signal);
}

export function createGlobTool(cwd: string): PresentedTool<typeof schema> {
  return {
    name: "glob",
    description:
      "Find files by glob, including dotfiles, respecting nested .gitignore files. Skips .git and directory symlinks.",
    parameters: schema,
    presentCall: (args) => ({
      card: "generic",
      kind: "search",
      displayKey: "tool.glob",
      rawInput: args,
    }),
    presentResult: (_args, _text, details) =>
      Value.Check(facts, details)
        ? { card: "search", kind: "search", displayKey: "tool.glob", shape: "paths", ...details }
        : undefined,
    async execute({ pattern, path }, _api, context) {
      const signal = context.abortSignal;
      const root = resolve(cwd, path ?? ".");
      const glob = new Bun.Glob(pattern);
      const matches: string[] = [];
      let ancestors: IgnoreRules[] = [];
      const ignoreRoot = (await repositoryRoot(root, signal)) ?? cwd;
      const scoped = relative(ignoreRoot, root);
      // A narrower search retains every parent rule and cannot re-enter a
      // pruned directory just by naming it explicitly.
      if (scoped && scoped !== ".." && !scoped.startsWith(`..${sep}`) && !isAbsolute(scoped)) {
        let directory = ignoreRoot;
        for (const segment of scoped.split(sep)) {
          ancestors = await loadRules(directory, ancestors);
          directory = join(directory, segment);
          if (segment === ".git" || isIgnored(directory, true, ancestors)) {
            return {
              content: [{ type: "text", text: "No matching files." }],
              details: { paths: [], total: 0 },
            };
          }
        }
      }
      async function walk(directory: string, inherited: IgnoreRules[]) {
        signal?.throwIfAborted();
        const rules = await loadRules(directory, inherited);
        for await (const entry of new Bun.Glob("*").scan({
          cwd: directory,
          dot: true,
          onlyFiles: false,
          followSymlinks: false,
        })) {
          signal?.throwIfAborted();
          if (entry === ".git") continue;
          const absolute = join(directory, entry);
          const info = await lstat(absolute);
          if (isIgnored(absolute, info.isDirectory(), rules)) continue;
          if (info.isDirectory()) await walk(absolute, rules);
          else if (info.isFile() && glob.match(relative(root, absolute).split(sep).join("/"))) {
            matches.push(relative(root, absolute).split(sep).join("/"));
          }
        }
      }
      await walk(root, ancestors);
      const output = truncateHead(matches.sort().join("\n"));
      // A byte cutoff may leave an incomplete final path; show only complete facts.
      const paths = output.content ? output.content.split("\n") : [];
      if (output.truncated && output.truncatedBy === "bytes") paths.pop();
      return {
        content: [
          {
            type: "text",
            text:
              paths.join("\n") +
                (output.truncated ? "\n[Output truncated; narrow the search.]" : "") ||
              "No matching files.",
          },
        ],
        details: { paths, total: matches.length },
      };
    },
  };
}
