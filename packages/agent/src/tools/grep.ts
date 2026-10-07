import { truncateHead } from "./runtime.ts";
import { createUserVisibleError } from "@rukie/shared";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { PresentedTool } from "./presentation.ts";

const facts = Type.Object({
  matches: Type.Array(
    Type.Object({ path: Type.String(), line: Type.Number(), text: Type.String() }),
  ),
  total: Type.Number(),
});

const matchEvent = Type.Object({
  type: Type.Literal("match"),
  data: Type.Object({
    path: Type.Object({ text: Type.String() }),
    lines: Type.Object({ text: Type.String() }),
    line_number: Type.Number(),
  }),
});

const schema = Type.Object({
  pattern: Type.String({ description: "Regular expression to search for." }),
  path: Type.Optional(
    Type.String({ description: "File or directory to search; defaults to cwd." }),
  ),
});

export function createGrepTool(cwd: string): PresentedTool<typeof schema> {
  return {
    name: "grep",
    description:
      "Search file contents with ripgrep (rg), respecting ignore files. Returns path:line:text matches.",
    parameters: schema,
    presentCall: (args) => ({
      card: "generic",
      kind: "search",
      displayKey: "tool.grep",
      rawInput: args,
    }),
    presentResult: (_args, _text, details) =>
      Value.Check(facts, details)
        ? { card: "search", kind: "search", displayKey: "tool.grep", shape: "matches", ...details }
        : undefined,
    async execute({ pattern, path }, _api, context) {
      const signal = context.abortSignal;
      signal?.throwIfAborted();
      let proc;
      try {
        const { rgPath: rg } = await import("@vscode/ripgrep");
        signal?.throwIfAborted();
        proc = Bun.spawn(
          [
            rg,
            "--json",
            "--line-number",
            "--with-filename",
            "--no-heading",
            "--color",
            "never",
            "--regexp",
            pattern,
            "--",
            path ?? ".",
          ],
          {
            cwd,
            signal,
            timeout: 60_000,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          },
        );
      } catch (error) {
        signal?.throwIfAborted();
        const cause = error instanceof Error ? error.message : String(error);
        throw createUserVisibleError(
          `Bundled ripgrep is unavailable. Reinstall Rukie dependencies (including optionalDependencies) and check platform compatibility or binary execution permissions. Cause: ${cause}`,
          { code: "ripgrep-unavailable", params: { cause } },
          { cause: error },
        );
      }
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      signal?.throwIfAborted();
      if (code !== 0 && code !== 1)
        throw new Error(stderr.trim() || `rg failed with exit code ${code}.`);
      // ripgrep JSON makes path boundaries unambiguous, including colons and newlines.
      const allMatches = stdout
        .trimEnd()
        .split("\n")
        .flatMap((record) => {
          if (!record) return [];
          const event: unknown = JSON.parse(record);
          return Value.Check(matchEvent, event)
            ? [
                {
                  path: event.data.path.text,
                  line: event.data.line_number,
                  text: event.data.lines.text.replace(/\r?\n$/, ""),
                },
              ]
            : [];
        });
      const output = truncateHead(
        allMatches.map((match) => `${match.path}:${match.line}:${match.text}`).join("\n"),
      );
      // A byte cutoff can leave a partial final line. Keep only complete match facts.
      let consumed = 0;
      const matches = allMatches.filter((match, index) => {
        consumed += `${match.path}:${match.line}:${match.text}`.length + (index ? 1 : 0);
        return consumed <= output.content.length;
      });
      const total = allMatches.length;
      return {
        content: [
          {
            type: "text",
            text: output.content
              ? output.content +
                (output.truncated ? "\n[Output truncated; narrow the search.]" : "")
              : "No matches.",
          },
        ],
        details: { matches, total },
      };
    },
  };
}
